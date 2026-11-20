// `/tune` with words: each command reads or changes profiles and answers in text.
import { render } from './brief'
import type { Level, Profile } from './profile'
import { cannotRemove, change, create, get, has, kind, load, names, remove, reset, use } from './store'
import type { Io, World } from './store'

export const HELP = [
  'Commands (after /tune, or in the panel\'s command field). /tune alone opens the panel; /tune close closes it.',
  '  list                              profiles; * marks the one in force',
  '  show [name]                       one profile\'s dials',
  '  use <name>                        put a profile in force',
  '  new <name> [from <name>]          copy a profile',
  '  set <dial> <value> [in <name>]    change one dial, for example: set executor effort high',
  '  delete <name>                     delete one of your own profiles',
  '  reset <name>                      return a changed shipped profile to its shipped values',
  '  brief [name]                      the working rules a profile gives',
  '  why [name]                        the reason for each level',
  'Dials: main.model, main.effort, <role> model, <role> effort, team, agents, review,',
  'escalation (on or off), order, start_higher, summary, tests, notes.',
].join('\n')

// These take the rest of the line as their value, so they cannot be followed by "in <name>".
const TEXT_DIALS = new Set(['summary', 'tests', 'notes'])

export type Answer = { text: string; changed: boolean }

/** The command was not one, or was not used as it is written in HELP. */
class Usage extends Error {}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const level = (one: Level): string => `${one.model} / ${one.effort}`

function table(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2

  return rows.map(([label, value]) => `${label.padEnd(width)}${value}`).join('\n')
}

function list(world: World): string {
  const lines = names(world).map(name => {
    const mark = name === world.inForce ? '* ' : '  '
    const what = kind(world, name)
    // A changed copy that cannot be read: the shipped values are what is in force.
    const unread = has(world.broken, name) ? `, cannot be read: ${world.broken[name]}` : ''

    return `${mark}${name}${what === 'own' ? '' : `  (${what}${unread})`}`
  })
  for (const [name, why] of Object.entries(world.broken)) {
    if (!has(world.shipped, name)) {
      lines.push(`  ${name}  (cannot be read: ${why})`)
    }
  }
  if (world.note) {
    lines.push(world.note)
  }
  if (world.storeError) {
    lines.push(world.storeError)
  }

  return lines.join('\n')
}

export function show(profile: Profile): string {
  const rows: [string, string][] = [['you', level(profile.main)]]
  for (const [role, one] of Object.entries(profile.roles)) {
    rows.push([role, level(one)])
  }
  rows.push(
    ['team', profile.team],
    ['agents', profile.agents],
    ['review', profile.review],
    ['escalation', profile.escalation ? 'on' : 'off'],
    ['order', profile.order.join(', ')],
    ['start_higher', profile.start_higher.join(', ') || '(none)'],
    ['tests', profile.tests || '(none)'],
    ['notes', profile.notes || '(none)'],
  )

  return `${profile.name}: ${profile.summary}\n${table(rows)}`
}

export type WhyRow = { who: string; level: string; multiple: string; note: string }

/** One row for the main conversation and one per role: the price multiple and the reason. */
export function explain(profile: Profile, notes: any): { rows: WhyRow[]; caveats: string[]; sources: string[] } {
  const models: Record<string, any> = notes?.models ?? {}
  const efforts: Record<string, any> = notes?.effort ?? {}
  const base = Number(models[notes?.base]?.input)
  const sources: string[] = []
  const cite = (url: unknown): void => {
    if (typeof url === 'string' && url !== '' && !sources.includes(url)) {
      sources.push(url)
    }
  }
  const row = (who: string, one: Level): WhyRow => {
    const alias = one.model in models ? one.model : Object.keys(models).find(name => models[name]?.id === one.model)
    const general = String(efforts.general?.[one.effort] ?? '')
    if (alias === undefined) {
      return { who, level: level(one), multiple: '?', note: `There is no note for this model. ${general}`.trim() }
    }
    const model = models[alias]
    const own = efforts[alias] ?? {}
    cite(model.source)
    cite(notes?.prices_source)
    cite(one.effort in own ? own.source : notes?.effort_source)
    const multiple = Number.isFinite(base) && base > 0 ? `${Number((Number(model.input) / base).toFixed(4))}x` : '?'

    return { who, level: level(one), multiple, note: `${model.note} ${own[one.effort] ?? general}`.trim() }
  }
  const rows = [row('you', profile.main), ...Object.entries(profile.roles).map(([role, one]) => row(role, one))]

  return { rows, caveats: Array.isArray(notes?.caveats) ? notes.caveats.map(String) : [], sources }
}

async function why(io: Io, profile: Profile): Promise<string> {
  let notes: unknown
  try {
    notes = JSON.parse(await io.read(`${io.root}/notes.json`))
  } catch {
    throw new Error('the notes that explain the levels could not be read')
  }
  const { rows, caveats, sources } = explain(profile, notes)
  const who = Math.max(...rows.map(row => row.who.length)) + 2
  const lvl = Math.max(...rows.map(row => row.level.length)) + 2
  const lines = [`${profile.name}: price is each model's multiple of Sonnet's, per token.`]
  for (const row of rows) {
    lines.push(`${row.who.padEnd(who)}${row.level.padEnd(lvl)}${row.multiple}`, `  ${row.note}`)
  }

  return [...lines, '', ...caveats, ...(sources.length > 0 ? ['', 'Sources:', ...sources.map(url => `  ${url}`)] : [])].join(
    '\n',
  )
}

async function set(io: Io, world: World, rest: string[]): Promise<Answer> {
  if (rest.length < 2) {
    throw new Usage('set needs a dial and a value')
  }
  let target = world.inForce
  let words = rest
  // "... in <name>" at the end names another profile, when there is one of that name;
  // otherwise it is part of the value. A dial that takes free text never reads it so.
  const last = rest[rest.length - 1] as string
  const named = has(world.own, last) || has(world.shipped, last) || has(world.broken, last)
  if (!TEXT_DIALS.has(rest[0] as string) && rest.length >= 4 && rest[rest.length - 2] === 'in' && named) {
    target = last
    words = rest.slice(0, -2)
  }
  const profile = get(world, target)

  let path = words[0] as string
  let value = words.slice(1).join(' ')
  let said = path
  // "executor effort high" is the short way to write "roles.executor.effort high"; "main" likewise.
  const isRole = has(profile.roles, path)
  if ((isRole || path === 'main') && (words[1] === 'model' || words[1] === 'effort')) {
    if (words.length < 3) {
      throw new Usage('set needs a dial and a value')
    }
    said = `${path} ${words[1]}`
    path = isRole ? `roles.${path}.${words[1]}` : `main.${words[1]}`
    value = words.slice(2).join(' ')
  }

  const wasShipped = kind(world, target) === 'shipped'
  await change(io, target, path, value)
  const copyNote = wasShipped
    ? ` ${target} is now your own copy; "reset ${target}" returns it to its shipped values.`
    : ''

  return { text: `${target}: ${said} is now ${value}.${copyNote}`, changed: true }
}

async function act(io: Io, words: string[]): Promise<Answer> {
  const [verb, ...rest] = words
  if (verb === undefined) {
    return { text: HELP, changed: false }
  }
  const world = await load(io)
  const one = (what: string): string => {
    if (rest.length !== 1) {
      throw new Usage(`${verb} needs ${what}`)
    }

    return rest[0] as string
  }
  const optional = (): string => {
    if (rest.length > 1) {
      throw new Usage(`${verb} takes one name at most`)
    }

    return rest[0] ?? world.inForce
  }

  switch (verb) {
    case 'list':
      return { text: list(world), changed: false }
    case 'show':
      return { text: show(get(world, optional())), changed: false }
    case 'brief':
      return { text: render(get(world, optional())), changed: false }
    case 'why':
      return { text: await why(io, get(world, optional())), changed: false }
    case 'use': {
      const name = one('a profile name')
      await use(io, name)

      return { text: `${name} is in force.`, changed: true }
    }
    case 'new': {
      if (!(rest.length === 1 || (rest.length === 3 && rest[1] === 'from'))) {
        throw new Usage('new needs a name, and may be followed by: from <name>')
      }
      const from = rest[2] ?? world.inForce
      await create(io, rest[0] as string, from)

      return { text: `${rest[0]} created from ${from}.`, changed: true }
    }
    case 'set':
      return set(io, world, rest)
    case 'delete': {
      if (rest.length === 2 && rest[1] === 'yes') {
        const after = await remove(io, rest[0] as string)
        const fell = world.inForce === rest[0] ? ` ${after.inForce} is in force.` : ''

        return { text: `${rest[0]} is deleted.${fell}`, changed: true }
      }
      const name = one('a profile name')
      // Say what is wrong now, not after the person has confirmed.
      const refusal = cannotRemove(world, name)
      if (refusal !== null) {
        throw new Error(refusal)
      }

      return { text: `To delete ${name}, repeat the command as: delete ${name} yes`, changed: false }
    }
    case 'reset': {
      const name = one('a profile name')
      await reset(io, name)

      return { text: `${name} is back to its shipped values.`, changed: true }
    }
    default:
      throw new Usage(`'${verb}' is not a command`)
  }
}

/** Runs one command. Never rejects: a refusal is one line, a misuse adds the commands that exist. */
export async function run(io: Io, words: string[]): Promise<Answer> {
  try {
    return await act(io, words)
  } catch (error) {
    if (error instanceof Usage) {
      return { text: `tune: ${error.message}\n\n${HELP}`, changed: false }
    }

    return { text: `tune: ${reason(error)}`, changed: false }
  }
}

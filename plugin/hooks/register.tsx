// Tune's mod: applies the profile in force to the role agents, gives the
// main conversation its working rules, answers /tune, and draws the row
// above the prompt and the panel.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Level, Profile, View } from '../types'
import { apply } from './apply'
import { GUARD, render } from './brief'
import { explain, run, show } from './commands'
import { EFFORTS, MODELS } from './profile'
import { change, create, get, has, keep, kind, load, names, remove, reset, use } from './store'
import type { Io } from './store'

const REPLACES =
  'Tune: the profile in force changed. These rules replace the earlier Tune rules in this conversation.\n\n'

const PANE = 'tune'

const EMPTY: View = { world: null, brief: '', applied: '', problems: [] }

// Problems already shown in a toast, so a later refresh does not repeat them.
const told = new Set<string>()

const view = atom({ plugin: 'tune', key: 'view' } as const, EMPTY, { shape: 'view-1' })
const main = atom({ plugin: 'tune', key: 'main' } as const, null as Level | null, { shape: 'main-1' })
// The rules this conversation has been given: null until the session has looked.
const seenBrief = atom({ plugin: 'tune', key: 'seenBrief' } as const, null as string | null)
const message = atom({ plugin: 'tune', key: 'message' } as const, null as string | null)
const tick = atom({ plugin: 'tune', key: 'tick' } as const, 0)
const why = atom({ plugin: 'tune', key: 'why' } as const, false)
// The profile a delete is waiting to have confirmed by a second press.
const confirm = atom({ plugin: 'tune', key: 'confirm' } as const, null as string | null)

/** The words of a command. Nothing is quoted: a name has no spaces, and a note keeps its quotes. */
const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(word => word !== '')

const clip = (text: string, room: number): string =>
  text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`
const short = (effort: string): string => (effort === 'medium' ? 'med' : effort)
const thousands = (tokens: number): string => `${Math.round(tokens / 1000)}K`
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const ORDERS = [
  ['correct', 'time', 'tokens'],
  ['correct', 'tokens', 'time'],
  ['time', 'correct', 'tokens'],
  ['time', 'tokens', 'correct'],
  ['tokens', 'correct', 'time'],
  ['tokens', 'time', 'correct'],
]

/** "build-2" for build, then "build-3": the first such name nobody has. */
function nextName(taken: string[], inForceNow: string): string {
  const base = inForceNow.replace(/-\d+$/, '')
  for (let n = 2; n < 100; n += 1) {
    if (!taken.includes(`${base}-${n}`)) {
      return `${base}-${n}`
    }
  }

  return `${base}-copy`
}

/** The profile in force, or null when the session has none it can use. */
function inForce(now: View): Profile | null {
  if (now.world === null) {
    return null
  }

  const { own, shipped, inForce: name } = now.world
  if (has(own, name)) {
    return own[name] ?? null
  }

  return has(shipped, name) ? (shipped[name] ?? null) : null
}

/** One line of at most `room` characters: what does not fit is dropped in steps, then cut. */
export function rowText(now: View, mine: Level | null, room: number): string {
  const profile = inForce(now)
  if (profile === null) {
    return clip('tune: not loaded', room)
  }
  const name = `tune: ${profile.name}`
  const levels: string[] = []
  const exec = profile.roles.executor
  const review = profile.roles['code-reviewer']
  if (exec) {
    levels.push(`exec ${exec.model}/${short(exec.effort)}`)
  }
  if (review) {
    levels.push(`review ${review.model}/${short(review.effort)}`)
  }
  // The main conversation runs at another effort than the profile recommends.
  const marks = mine !== null && mine.effort !== profile.main.effort ? [`you ${mine.effort}!`] : []
  const tries = [
    [name, ...levels, ...marks],
    [name, ...levels.slice(0, 1), ...marks],
    [name, ...marks],
    [name],
  ]
  for (const attempt of tries) {
    const text = attempt.join(' · ')
    if (text.length <= room) {
      return text
    }
  }

  return clip(name, room)
}

/** The engine calls store.ts and apply.ts need, taken from `$`. */
function ioOf($: any): Io {
  return {
    root: String($.plugin.root),
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    keys: () => $.store.keys(),
    drop: key => $.store.delete(key),
    read: async path => String(await $.fs.read(path)),
    register: spec => $.agent.register(spec),
  }
}

/** Loads the profiles, puts the one in force on the role agents, and records what was done. */
async function refresh($: any): Promise<View> {
  const io = ioOf($)
  const world = await load(io)
  let brief = ''
  let problems: string[] = []
  try {
    const profile = get(world, world.inForce)
    problems = await apply(io, profile)
    brief = render(profile)
  } catch {
    // No usable profile: the personas keep the levels in their own files, and there are no rules to give.
  }
  const now: View = { world, brief, applied: world.stamp, problems }
  await update($, view, () => now)
  // Say each problem once, where a person will see it.
  for (const problem of problems) {
    if (!told.has(problem)) {
      told.add(problem)
      $.ui.toast(`tune: ${problem}`)
    }
  }

  return now
}

/**
 * The rules to hand a running conversation, if they differ from the ones it has.
 * The system prompt is composed once, so a later change travels beside a prompt.
 */
async function handOver($: any, now: View): Promise<string | null> {
  const seen = await read($, seenBrief)
  if (now.brief === '' || now.brief === seen) {
    return null
  }
  await update($, seenBrief, () => now.brief)

  return seen === null ? null : REPLACES + now.brief
}

/**
 * One change asked for in the panel: does it, says what went wrong if it was
 * refused, and applies the result. The rules reach the conversation with its next prompt.
 */
async function act($: any, work: (io: Io) => Promise<unknown>): Promise<void> {
  let said: string | null = null
  try {
    await work(ioOf($))
  } catch (error) {
    said = `tune: ${reason(error)}`
  }
  await update($, message, () => said)
  await update($, confirm, () => null)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    told.clear()
    try {
      await $.command.register({
        name: 'tune',
        description: 'Show or change the Tune profile in force (model and effort per role agent)',
      })
    } catch {
      // Without the command the levels and the rules still apply.
    }
    try {
      const now = await refresh($)
      // The system prompt carries these rules from the first request on.
      await update($, seenBrief, () => now.brief)
    } catch {
      // The session must start whatever happens to Tune.
    }

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) {
      return next(e)
    }
    let context: string | null = null
    try {
      let now = await read($, view)
      const stamp = await $.store.get('stamp')
      if (now.world === null || String(stamp ?? '') !== now.applied) {
        // Another session, or the panel, changed something since this one last looked.
        now = await refresh($)
      }
      context = await handOver($, now)
    } catch {
      // Never stand between a prompt and the model.
    }

    return context === null ? next(e) : next({ ...e, context: [...(e.context ?? []), context] })
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    try {
      const { brief } = await read($, view)
      if (brief !== '') {
        return {
          sections: [
            ...composed.sections,
            { id: 'tune:brief', text: `${GUARD}\n\n${brief}`, scope: 'session' as const },
          ],
        }
      }
    } catch {
      // Without the rules the prompt is still whole.
    }

    return composed
  })

  on('command.run', { command: 'tune' }, async ($, e) => {
    try {
      const words = splitWords(e.args)
      if (words.length === 0) {
        await $.ui.open({ id: PANE, title: 'Tune', focus: true, columns: 50 })
        const profile = inForce(await refresh($))

        return { text: profile === null ? 'tune: no profile could be loaded' : show(profile) }
      }
      const answer = await run(ioOf($), words)
      await update($, message, () => answer.text)
      if (!answer.changed) {
        return { text: answer.text }
      }
      let context: string | null = null
      try {
        context = await handOver($, await refresh($))
      } catch {
        // The change is saved; the next prompt applies it and hands the rules over.
      }

      return context === null ? { text: answer.text } : { text: answer.text, context: [context] }
    } catch (error) {
      return { text: `tune: ${error instanceof Error ? error.message : String(error)}` }
    }
  })

  on('turn.step', async function* ($, e, next) {
    try {
      if (e.agentId === undefined) {
        const now = await read($, main)
        if (typeof e.effort === 'string' && (now === null || now.model !== e.model || now.effort !== e.effort)) {
          const level: Level = { model: e.model, effort: e.effort }
          await update($, main, () => level)
        }
      } else {
        await update($, tick, count => (count ?? 0) + 1)
      }
    } catch {
      // Never stand between a request and the model.
    }

    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    // The button beside the text needs about ten columns; on a very narrow row the text takes what there is.
    const columns = e.props.bodyColumns
    const room = Math.max(columns - 10, Math.min(columns, 16))
    const line = rowText(await read($, view), await read($, main), room)

    return (
      <Box>
        <Text dimColor>{line} </Text>
        <Button
          key="panel"
          label="panel"
          hotkey="t"
          plain
          onPress={() => {
            void $.ui.open({ id: PANE, title: 'Tune', focus: true, columns: 50 })
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Select, Text } = $.ui.resolve(e)
    const now = await read($, view)
    const mine = await read($, main)
    if (e.props.placement === 'widget') {
      return <Text dimColor>{rowText(now, mine, e.props.bodyColumns)}</Text>
    }
    const said = await read($, message)
    const showWhy = await read($, why)
    const asking = await read($, confirm)
    await read($, tick)

    const world = now.world
    const profile = inForce(now)
    const lines = (text: string | null) => (text === null ? [] : text.split('\n')).map(line => <Text dimColor>{line}</Text>)
    const command = (
      <Input
        key="command"
        label="command"
        placeholder="a tune command, for example: set notes Ask before adding a dependency"
        onSubmit={async value => {
          const answer = await run(ioOf($), splitWords(value))
          await update($, message, () => answer.text)
          await update($, confirm, () => null)
          if (answer.changed) {
            await refresh($)
          }
        }}
      />
    )
    if (world === null || profile === null) {
      return (
        <Box flexDirection="column">
          <Text>Tune has no profile it can use.</Text>
          <Text dimColor>{world?.storeError ?? 'Nothing has been loaded yet.'}</Text>
          <Text dimColor>The role agents still run at the levels in their own files.</Text>
          <Button key="retry" label="try again" hotkey="r" onPress={() => act($, async () => undefined)} />
        </Box>
      )
    }

    const name = world.inForce
    const what = kind(world, name)
    const filled = world.filled[name] ?? []
    const all = names(world)
    const mismatch = mine !== null && mine.effort !== profile.main.effort
    let running: any[] = []
    try {
      running = (await $.agent.list()).filter((agent: any) => agent.taskStatus === 'running')
    } catch {
      running = []
    }
    let reasons: ReturnType<typeof explain> | null = null
    if (showWhy) {
      try {
        reasons = explain(profile, JSON.parse(String(await $.fs.read(`${$.plugin.root}/notes.json`))))
      } catch {
        reasons = { rows: [], caveats: ['The notes that explain the levels could not be read.'], sources: [] }
      }
    }
    const set = (path: string) => (value: string) => act($, io => change(io, name, path, value))

    return (
      <Box flexDirection="column">
        <Text dimColor>
          Tune · {name} · in force on this machine{what === 'changed' ? ' · changed from the shipped profile' : ''}
        </Text>
        {world.note !== null && <Text dimColor>{world.note}</Text>}
        {world.storeError !== null && <Text dimColor>{world.storeError}</Text>}
        <Box>
          {all.slice(0, 9).map((one, index) => (
            <Button
              key={`use:${one}`}
              label={one}
              hotkey={String(index + 1)}
              variant={one === name ? 'primary' : 'secondary'}
              onPress={() => act($, io => use(io, one))}
            />
          ))}
          <Button
            key="new"
            label="+ new"
            hotkey="n"
            onPress={() =>
              act($, async io => {
                const fresh = await load(io)
                const made = nextName([...names(fresh), ...Object.keys(fresh.broken)], fresh.inForce)
                await create(io, made)
                await use(io, made)
              })
            }
          />
        </Box>
        {Object.entries(world.broken)
          .filter(([one]) => !has(world.shipped, one))
          .map(([one, cause]) => (
            <Box>
              <Text dimColor>
                {one} cannot be read: {cause}{' '}
              </Text>
              <Button key={`delete-broken:${one}`} label="delete it" onPress={() => act($, io => remove(io, one))} />
            </Box>
          ))}
        <Text>
          {profile.name}: {profile.summary}
        </Text>
        <Text dimColor>── levels ──</Text>
        <Text>
          {'you'.padEnd(19)}
          {profile.main.model} / {profile.main.effort}
          {mismatch ? `   (now: ${mine?.effort} - set with /effort ${profile.main.effort})` : ''}
        </Text>
        {Object.entries(profile.roles).map(([role, level]) => (
          <Box>
            <Text>
              {role.padEnd(19)}
              {filled.includes(`roles.${role}`) ? 'new ' : ''}
            </Text>
            <Select
              key={`model:${role}`}
              options={[...new Set([...MODELS, level.model])].map(value => ({ value }))}
              value={level.model}
              onSelect={set(`roles.${role}.model`)}
            />
            <Text> </Text>
            <Select
              key={`effort:${role}`}
              options={EFFORTS.map(value => ({ value }))}
              value={level.effort}
              onSelect={set(`roles.${role}.effort`)}
            />
          </Box>
        ))}
        {filled.length > 0 && (
          <Box>
            <Text dimColor>An update added what is marked new, at the shipped values. </Text>
            <Button key="keep" label="keep these" hotkey="k" onPress={() => act($, io => keep(io, name))} />
          </Box>
        )}
        <Text dimColor>── rules ──</Text>
        <Select
          key="team"
          label="team      "
          options={[
            { value: 'when-split', label: 'when the work splits' },
            { value: 'always', label: 'always' },
            { value: 'never', label: 'never' },
          ]}
          value={profile.team}
          onSelect={set('team')}
        />
        <Select
          key="agents"
          label="agents    "
          options={[
            { value: 'fresh-per-task', label: 'a fresh agent per task' },
            { value: 'may-continue', label: 'agents may continue' },
          ]}
          value={profile.agents}
          onSelect={set('agents')}
        />
        <Select
          key="review"
          label="review    "
          options={[
            { value: 'each-milestone', label: 'each milestone' },
            { value: 'each-task', label: 'each task' },
          ]}
          value={profile.review}
          onSelect={set('review')}
        />
        <Select
          key="escalation"
          label="escalate  "
          options={[{ value: 'on' }, { value: 'off' }]}
          value={profile.escalation ? 'on' : 'off'}
          onSelect={set('escalation')}
        />
        <Select
          key="order"
          label="order     "
          options={ORDERS.map(order => ({ value: order.join(','), label: order.join(' > ') }))}
          value={profile.order.join(',')}
          onSelect={set('order')}
        />
        <Text dimColor>one level up for: {profile.start_higher.join(', ') || 'nothing'}</Text>
        <Text dimColor>── running now ──</Text>
        {running.length === 0 && <Text dimColor>no agents running</Text>}
        {running.slice(0, 12).map((agent: any) => (
          <Text>
            {String(agent.type).replace(/^tune:/, '').padEnd(19)}
            {String(agent.model ?? '?').replace('claude-', '')} / {agent.effort ?? '-'}
            {typeof agent.tokenCount === 'number' ? `   ${thousands(agent.tokenCount)}` : ''}
          </Text>
        ))}
        <Box>
          <Button
            key="why"
            label={showWhy ? 'hide the reasons' : 'why these levels'}
            hotkey="w"
            onPress={async () => {
              await update($, confirm, () => null)
              await update($, why, shown => !shown)
            }}
          />
          {what === 'changed' && (
            <Button key="reset" label="reset to shipped" hotkey="r" onPress={() => act($, io => reset(io, name))} />
          )}
          {what === 'own' && (
            <Button
              key="delete"
              label="delete"
              hotkey="d"
              onPress={async () => {
                if ((await read($, confirm)) === name) {
                  await act($, io => remove(io, name))

                  return
                }
                await update($, message, () => null)
                await update($, confirm, () => name)
              }}
            />
          )}
        </Box>
        {asking === name && <Text>Delete {name}? Press delete again.</Text>}
        {reasons !== null &&
          reasons.rows.map(row => (
            <Box flexDirection="column">
              <Text>
                {row.who}: {row.level}
                {row.multiple === '?' ? '' : `, ${row.multiple} the price of Sonnet`}
              </Text>
              <Text dimColor>  {row.note}</Text>
            </Box>
          ))}
        {reasons !== null && reasons.caveats.map(caveat => <Text dimColor>{caveat}</Text>)}
        {reasons !== null && reasons.sources.map(source => <Text dimColor>  {source}</Text>)}
        {command}
        {lines(said)}
      </Box>
    )
  })
}

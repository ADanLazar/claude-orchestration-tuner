// Tune's mod: applies the profile in force to the role agents, gives the
// main conversation its working rules, answers /tune, and draws the row
// above the prompt.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Level, Profile, View } from '../types'
import { apply } from './apply'
import { GUARD, render } from './brief'
import { HELP, run } from './commands'
import { get, load } from './store'
import type { Io } from './store'

const REPLACES =
  'Tune: the profile in force changed. These rules replace the earlier Tune rules in this conversation.\n\n'

const PANE = 'tune'

const EMPTY: View = { world: null, brief: '', applied: 0, problems: [] }

const view = atom({ plugin: 'tune', key: 'view' } as const, EMPTY, { shape: 'view-1' })
const main = atom({ plugin: 'tune', key: 'main' } as const, null as Level | null, { shape: 'main-1' })
// The rules this conversation has been given: null until the session has looked.
const seenBrief = atom({ plugin: 'tune', key: 'seenBrief' } as const, null as string | null)
const message = atom({ plugin: 'tune', key: 'message' } as const, null as string | null)
const tick = atom({ plugin: 'tune', key: 'tick' } as const, 0)

/** Words as a shell would split them, double quotes kept together. */
function splitWords(text: string): string[] {
  const found = text.match(/"[^"]*"|\S+/g) ?? []

  return found.map(word => (word.startsWith('"') && word.endsWith('"') && word.length > 1 ? word.slice(1, -1) : word))
}

const clip = (text: string, room: number): string =>
  text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`
const short = (effort: string): string => (effort === 'medium' ? 'med' : effort)

/** The profile in force, or null when the session has none it can use. */
function inForce(now: View): Profile | null {
  if (now.world === null) {
    return null
  }

  return now.world.own[now.world.inForce] ?? now.world.shipped[now.world.inForce] ?? null
}

/** The row is one line: what does not fit is dropped in steps, then cut. */
export function rowText(now: View, mine: Level | null, columns: number): string {
  // The button beside the text needs about ten columns; on a very narrow row the text takes what there is.
  const room = Math.max(columns - 10, Math.min(columns, 16))
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await $.command.register({
        name: 'tune',
        description: 'Show or change the Tune profile in force (model and effort per role agent)',
      })
      const now = await refresh($)
      // The system prompt carries these rules from the first request on.
      await update($, seenBrief, () => now.brief)
      for (const problem of now.problems) {
        $.ui.toast(`tune: ${problem}`)
      }
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
      if (now.world === null || (typeof stamp === 'number' ? stamp : 0) !== now.applied) {
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
        return { text: HELP }
      }
      const answer = await run(ioOf($), words)
      await update($, message, () => answer.text)
      if (!answer.changed) {
        return { text: answer.text }
      }
      const context = await handOver($, await refresh($))

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
    const line = rowText(await read($, view), await read($, main), e.props.bodyColumns)

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
}

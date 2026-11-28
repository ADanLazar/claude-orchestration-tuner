// Tune's mod: applies the profile in force to the role agents, gives the
// main conversation its working rules, answers /tune, and draws the row
// above the prompt and the panel.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Level, Profile, View } from '../types'
import { apply } from './apply'
import { GUARD, render } from './brief'
import { explain, run } from './commands'
import { baseName, mdPaths, readPlan, relativeTo, resolvePath, touched } from './plan'
import { EFFORTS, MODELS } from './profile'
import {
  agentEnded,
  agentStarted,
  clear,
  isRunning,
  lines,
  NOTHING,
  observe,
  setTracker,
  shown,
  summary,
  track,
  unreadable,
} from './progress'
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
const progress = atom({ plugin: 'tune', key: 'progress' } as const, NOTHING, { shape: 'progress-1' })

const TOOL = 'mcp__tune__progress'
const TOOL_TEXT =
  'Tells Tune which plan file to show progress for. Call it once when work on a plan starts, with the plan\'s path. Pass tracker when the project has a tracker item for the work. Answers with the current counts.'
const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    plan: {
      type: 'string',
      description: 'Path of the plan file: a Markdown file whose tasks are headings and whose steps are checkboxes.',
    },
    tracker: {
      type: 'object',
      description: "The tracker item this work belongs to, in the tracker's own words.",
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        state: { type: 'string' },
        done: { type: 'number' },
        total: { type: 'number' },
      },
      required: ['id'],
    },
    clear: { type: 'boolean', description: 'True stops tracking.' },
  },
}

/** The words of a command. Nothing is quoted: a name has no spaces, and a note keeps its quotes. */
const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(word => word !== '')

const clip = (text: string, room: number): string =>
  text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`
const short = (effort: string): string => (effort === 'medium' ? 'med' : effort)
const thousands = (tokens: number): string => `${Math.round(tokens / 1000)}K`
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
/** A path as the model gave it, made one line for an answer: control characters become spaces. */
const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200)

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

// Enough rows for the whole panel where the terminal shows it above the prompt and not at the side.
const INLINE_ROWS = 37

/**
 * Reads the tracked plan again and records what changed; `by` names whose edit it was.
 * Nothing is read, and the clock is not asked, when no plan is tracked. Never throws.
 */
async function reread($: any, by: { agent: string | null; fragment: string } | null): Promise<void> {
  try {
    const { plan, anywhere } = await read($, progress)
    if (plan === null) {
      return
    }
    // A plan the model named is checked again: it may have become a link to a file outside.
    const real = anywhere ? plan : await insideProject($, plan)
    let text: string
    try {
      if (real === null) {
        throw new Error('not inside the project now')
      }
      text = String(await $.fs.read(real))
    } catch {
      await update($, progress, now => (now.plan === plan ? unreadable(now) : now))

      return
    }
    const tasks = readPlan(text, baseName(plan))
    const who = by && { agent: by.agent, task: touched(tasks, text, by.fragment) }
    const at = await $.clock.now()
    await update($, progress, now => (now.plan === plan ? observe(now, tasks, who, at) : now))
  } catch {
    // The counts stay as they were.
  }
}

/** Where a path really lands, links followed: null when it leads nowhere, undefined when that cannot be told. */
async function landing($: any, path: string): Promise<string | null | undefined> {
  try {
    const stat = await $.fs.stat(path, { resolve: true })

    return typeof stat.realPath === 'string' ? stat.realPath.replace(/\\/g, '/').replace(/\/+$/, '') : undefined
  } catch (error) {
    return / failed: ENOENT$/.test(reason(error)) ? null : undefined
  }
}

/**
 * Where an already resolved path really lands when it is a .md file inside the session's folder, and
 * null when it is not: by its spelling first (no disk access), then by where it lands. A path that leads
 * nowhere counts as inside, and is answered as given, when the nearest folder above it that is there
 * lands inside. What follows the check reads the path it answers.
 */
async function insideProject($: any, path: string): Promise<string | null> {
  const base = resolvePath(String(await $.session.cwd()), '')
  if (!path.startsWith(`${base}/`) || path.length === base.length + 1 || !/\.md$/i.test(path)) {
    return null
  }
  const root = await landing($, base)
  if (typeof root !== 'string' || root === '') {
    return null
  }
  for (let at = path, own = true; ; at = at.slice(0, at.lastIndexOf('/')), own = false) {
    const real = at === base ? root : await landing($, at)
    if (real === undefined) {
      return null
    }
    if (real !== null) {
      const inside = real.startsWith(`${root}/`) || (!own && real === root)

      return !inside ? null : own ? real : path
    }
  }
}

/**
 * What the tool answers: one line. The summary holds counts only, so it needs no time.
 * Only the person's own command (`anywhere`) tracks a plan outside the project or not named .md.
 */
async function answerTool($: any, input: Record<string, unknown>, anywhere = false): Promise<string> {
  if (input.clear === true) {
    await update($, progress, now => clear(now))

    return 'Nothing is tracked now.'
  }
  const plan = typeof input.plan === 'string' && input.plan !== '' ? input.plan : null
  if (plan === null) {
    await reread($, null)
  }
  let state = await read($, progress)
  // Both inputs are checked before either is applied.
  if (input.tracker !== undefined) {
    try {
      state = setTracker(state, input.tracker, await $.clock.now())
    } catch {
      return 'tune: tracker needs an id. Nothing was changed.'
    }
  }
  if (plan !== null) {
    const cwd = String(await $.session.cwd())
    const path = resolvePath(cwd, plan)
    const real = anywhere ? path : await insideProject($, path)
    if (real === null) {
      return `tune: ${oneLine(plan)} is not a .md file inside this project. To track it, ask the person to type /tune track <path>. Nothing was changed.`
    }
    let text: string
    try {
      text = String(await $.fs.read(real))
    } catch {
      return `tune: ${oneLine(plan)} could not be read. Nothing was changed.`
    }
    const tasks = readPlan(text, baseName(path))
    if (tasks.length === 0) {
      return `tune: ${oneLine(plan)} has no task with a checkbox. Nothing was changed.`
    }
    state = track(state, path, relativeTo(cwd, path), tasks, anywhere)
  }
  const done = state
  await update($, progress, () => done)
  const said = summary(shown(done, 0))

  return input.tracker !== undefined && done.tracker !== null ? `Tracker item ${done.tracker.id} noted. ${said}` : said
}

/** What `track …` answers, from /tune or the panel's field; null when the words are not a track command. */
async function trackCommand($: any, typed: string, anywhere: boolean): Promise<string | null> {
  const words = splitWords(typed)
  if (words[0] !== 'track') {
    return null
  }
  if (words.length === 1) {
    return 'Usage: /tune track <path> shows progress for a plan file, wherever it is; /tune track off stops.'
  }
  if (words.length === 2 && words[1] === 'off') {
    return answerTool($, { clear: true })
  }

  return answerTool($, { plan: typed.trim().replace(/^track\s+/, '') }, anywhere)
}

/** Each agent's id, mapped to the level it runs at: `sonnet-5-5 / medium`. `{}` when the list cannot be had. */
async function levelsOf($: any): Promise<Record<string, string>> {
  try {
    const levels: Record<string, string> = {}
    for (const agent of await $.agent.list()) {
      levels[String(agent.id)] = `${String(agent.model ?? '?').replace('claude-', '')} / ${agent.effort ?? '-'}`
    }

    return levels
  } catch {
    return {}
  }
}

/** What /tune status prints. With nothing tracked and no agent known, neither the clock nor the list is asked. */
async function statusText($: any, width: number): Promise<string> {
  const state = await read($, progress)
  if (state.plan === null && state.agents.length === 0) {
    return 'No plan is tracked.'
  }

  return lines(shown(state, await $.clock.now(), await levelsOf($)), width).join('\n')
}

// While an agent runs, the plan is read again this often: edits made through a shell are seen too.
const POLL_MS = 2000
// The one re-read timer: going only while an agent runs.
let poll: { cancel: () => void } | null = null

function stopPoll(): void {
  const timer = poll
  poll = null
  try {
    timer?.cancel()
  } catch {
    // A timer that cannot be stopped ends with its session.
  }
}

/** One period of the re-read: the plan, then each running agent as the engine lists it. Never throws. */
async function pollOnce($: any): Promise<void> {
  try {
    if (!isRunning(await read($, progress))) {
      stopPoll()

      return
    }
    await reread($, null)
    const listed: any[] = await $.agent.list()
    const at = await $.clock.now()
    await update($, progress, now => {
      let next = now
      for (const run of now.agents) {
        if (run.endedAt !== null) {
          continue
        }
        // A run the list no longer holds ended without a report: it reads `to check`.
        const status = listed.find(agent => agent.id === run.id)?.taskStatus ?? 'completed'
        if (status === 'completed' || status === 'failed') {
          next = agentEnded(next, run.id, status, at)
        } else if (status === 'killed') {
          next = agentEnded(next, run.id, 'stopped', at)
        }
      }

      return next
    })
  } catch {
    // The next period tries again.
  }
}

function startPoll($: any): void {
  if (poll === null) {
    poll = $.clock.every(POLL_MS, () => pollOnce($))
  }
}

/** Tracks the first .md file inside the project that an agent's prompt names and that holds a task. */
async function trackFromPrompt($: any, prompt: string): Promise<void> {
  const cwd = String(await $.session.cwd())
  for (const named of mdPaths(prompt)) {
    const path = resolvePath(cwd, named)
    const real = await insideProject($, path)
    if (real === null) {
      continue
    }
    let text: string
    try {
      text = String(await $.fs.read(real))
    } catch {
      continue
    }
    const tasks = readPlan(text, baseName(path))
    if (tasks.length > 0) {
      await update($, progress, now => (now.plan === null ? track(now, path, relativeTo(cwd, path), tasks) : now))

      return
    }
  }
}

/** Whether the engine lists the agent in another folder than the session's: a worktree of its own. */
async function elsewhere($: any, id: string): Promise<boolean> {
  try {
    const agent = (await $.agent.list()).find((one: any) => one.id === id)
    const cwd = resolvePath(String(await $.session.cwd()), '')

    return typeof agent?.cwd === 'string' && resolvePath(cwd, agent.cwd) !== cwd
  } catch {
    return false
  }
}

/** Opens the panel as a person first sees it: nothing is waiting to be confirmed. */
async function openPane($: any): Promise<void> {
  await update($, confirm, () => null)
  await $.ui.open({ id: PANE, title: 'Tune', focus: true, closeOnEscape: true, columns: 50, rows: INLINE_ROWS })
}

/** Closes the panel. A delete nobody confirmed is forgotten with it. */
async function closePane($: any): Promise<void> {
  await update($, confirm, () => null)
  await $.ui.close({ id: PANE })
}

async function isPaneOpen($: any): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((pane: any) => pane.id === PANE)
  } catch {
    return false
  }
}

/** What /tune answers once the panel is open: where it is, and how to close it. */
function openedText(presentation: { isFullscreen?: boolean } | undefined): string {
  const close = 'Close it with Esc, its close button, or /tune close.'
  if (presentation?.isFullscreen === true) {
    return `The Tune panel is open at the side. ${close}`
  }
  if (presentation?.isFullscreen === false) {
    return `The Tune panel is open above the prompt. ${close} For a panel at the side, type /tui fullscreen.`
  }

  return `The Tune panel is open. ${close}`
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
    stopPoll()
    try {
      await $.command.register({
        name: 'tune',
        description: 'Show or change the Tune profile in force (model and effort per role agent)',
      })
    } catch {
      // Without the command the levels and the rules still apply.
    }
    try {
      await $.tool.register({ name: 'progress', description: TOOL_TEXT, inputSchema: TOOL_SCHEMA, isDeferred: false })
    } catch {
      // Without the tool nothing is tracked; everything else still applies.
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
      await reread($, null)
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

  // Answered ahead of the permission check, so that the person is not asked to allow it.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    try {
      return { result: await answerTool($, e as unknown as Record<string, unknown>) }
    } catch (error) {
      return { result: `tune: ${reason(error)}` }
    }
  })

  // An edit of the tracked plan is read at once, and the tick goes to whoever made it.
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const answer = await next(e)
    try {
      const input = e as unknown as Record<string, unknown>
      const plan = (await read($, progress)).plan
      if (
        plan !== null &&
        answer.deny === undefined &&
        answer.isError !== true &&
        resolvePath(String(await $.session.cwd()), String(input.file_path ?? '')) === plan
      ) {
        const agent = typeof input.agentId === 'string' ? input.agentId : null
        await reread($, { agent, fragment: input.tool === 'Edit' ? String(input.new_string ?? '') : '' })
      }
    } catch {
      // Never stand between a tool and its answer.
    }

    return answer
  })

  // The agent is recorded when it starts, on the task its prompt names; a plan its prompt names is tracked when none is.
  on('agent.spawn', async ($, e, next) => {
    const answer = await next(e)
    try {
      if ((await read($, progress)).plan === null) {
        await trackFromPrompt($, e.prompt)
      }
      if (typeof answer.agentId === 'string') {
        const id = answer.agentId
        // An agent in a worktree of its own ticks a copy of the plan, which this session does not read.
        // The engine's types give the spawn no `isolation`, and a real one came without it: its folder decides too.
        const apart = (e as { isolation?: unknown }).isolation === 'worktree' || (await elsewhere($, id))
        const at = await $.clock.now()
        await update($, progress, now => agentStarted(now, { id, type: e.subagentType, prompt: e.prompt, apart }, at))
        startPoll($)
      }
    } catch {
      // Never stand between an agent and its start.
    }

    return answer
  })

  on('agent.report', async ($, e, next) => {
    const answer = await next(e)
    try {
      // An agent this session never saw start asks nothing of the clock.
      if ((await read($, progress)).agents.some(run => run.id === e.agentId)) {
        const at = await $.clock.now()
        await update($, progress, now => agentEnded(now, e.agentId, e.status, at))
        await reread($, null)
        if (!isRunning(await read($, progress))) {
          stopPoll()
        }
      }
    } catch {
      // Never stand between a report and the one it is for.
    }

    return answer
  })

  on('command.run', { command: 'tune' }, async ($, e) => {
    try {
      const words = splitWords(e.args)
      if (words.length === 0 || (words.length === 1 && words[0] === 'open')) {
        await openPane($)
        await refresh($)

        return { text: openedText(e.presentation) }
      }
      if (words.length === 1 && words[0] === 'close') {
        await closePane($)

        return { text: 'The Tune panel is closed.' }
      }
      if (words.length === 1 && words[0] === 'status') {
        // For the person alone: no model call, and the text stays out of later requests.
        return { text: await statusText($, Math.min(e.presentation?.columns ?? 80, 100)), isTextDisplayOnly: true as const }
      }
      // A plan outside the project is tracked only at the person's own Enter, at the terminal or through the bridge.
      const tracked = await trackCommand($, e.args, e.origin?.kind === 'composer' || e.origin?.kind === 'bridge')
      if (tracked !== null) {
        return { text: tracked }
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
          onPress={async () => ((await isPaneOpen($)) ? closePane($) : openPane($))}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // No button here has a one-key shortcut: the panel takes the keyboard when it opens, and a
    // person who starts typing their next prompt must not create, switch or delete a profile.
    // Tab and the arrows walk the buttons, Enter presses one, Esc closes the panel.
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
          const typed = splitWords(value)
          if (typed.length === 1 && typed[0] === 'status') {
            const text = await statusText($, e.props.bodyColumns)
            await update($, message, () => text)
            await update($, confirm, () => null)

            return
          }
          // The field is typed by the person.
          const tracked = await trackCommand($, value, true)
          if (tracked !== null) {
            await update($, message, () => tracked)
            await update($, confirm, () => null)

            return
          }
          const answer = await run(ioOf($), typed)
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
          <Box>
            <Button key="retry" label="try again" onPress={() => act($, async () => undefined)} />
            <Button key="close" label="close" role="dismiss" onPress={() => closePane($)} />
          </Box>
        </Box>
      )
    }

    const name = world.inForce
    const what = kind(world, name)
    const filled = has(world.filled, name) ? (world.filled[name] ?? []) : []
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
    // Choosing the value already shown is not a change: it must not turn a shipped profile into a copy.
    const set = (path: string, current: string) => (value: string) =>
      value === current ? undefined : act($, io => change(io, name, path, value))

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="close" label="close" role="dismiss" onPress={() => closePane($)} />
          <Text dimColor>
            {' '}
            Tune · {name} · in force on this machine{what === 'changed' ? ' · changed from the shipped profile' : ''}
          </Text>
        </Box>
        {e.surface === 'terminal' && e.props.placement === 'inline' && (
          <Text dimColor>Shown above the prompt. For a panel at the side, type /tui fullscreen.</Text>
        )}
        {world.note !== null && <Text dimColor>{world.note}</Text>}
        {world.storeError !== null && <Text dimColor>{world.storeError}</Text>}
        <Box>
          {all.map(one => (
            <Button
              key={`use:${one}`}
              label={one}
              variant={one === name ? 'primary' : 'secondary'}
              onPress={() => act($, io => use(io, one))}
            />
          ))}
          <Button
            key="new"
            label="+ new"
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
            <Box flexDirection="column">
              <Box>
                <Text dimColor>
                  {one} cannot be read: {cause}{' '}
                </Text>
                <Button
                  key={`delete-broken:${one}`}
                  label="delete it"
                  onPress={async () => {
                    // It may hold settings an update made unreadable, so it is asked twice like any other.
                    if ((await read($, confirm)) === `broken:${one}`) {
                      await act($, io => remove(io, one))

                      return
                    }
                    await update($, message, () => null)
                    await update($, confirm, () => `broken:${one}`)
                  }}
                />
              </Box>
              {asking === `broken:${one}` && <Text>Delete {one}? Press delete it again.</Text>}
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
              onSelect={set(`roles.${role}.model`, level.model)}
            />
            <Text> </Text>
            <Select
              key={`effort:${role}`}
              options={EFFORTS.map(value => ({ value }))}
              value={level.effort}
              onSelect={set(`roles.${role}.effort`, level.effort)}
            />
          </Box>
        ))}
        {filled.length > 0 && (
          <Box>
            <Text dimColor>An update added what is marked new, at the shipped values. </Text>
            <Button key="keep" label="keep these" onPress={() => act($, io => keep(io, name))} />
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
          onSelect={set('team', profile.team)}
        />
        <Select
          key="agents"
          label="agents    "
          options={[
            { value: 'fresh-per-task', label: 'a fresh agent per task' },
            { value: 'may-continue', label: 'agents may continue' },
          ]}
          value={profile.agents}
          onSelect={set('agents', profile.agents)}
        />
        <Select
          key="review"
          label="review    "
          options={[
            { value: 'each-milestone', label: 'each milestone' },
            { value: 'each-task', label: 'each task' },
          ]}
          value={profile.review}
          onSelect={set('review', profile.review)}
        />
        <Select
          key="questions"
          label="questions "
          options={[
            { value: 'when-unclear', label: 'when something is open' },
            { value: 'always', label: 'always' },
            { value: 'never', label: 'never' },
          ]}
          value={profile.questions}
          onSelect={set('questions', profile.questions)}
        />
        <Select
          key="reports"
          label="reports   "
          options={[
            { value: 'each-milestone', label: 'each milestone' },
            { value: 'each-task', label: 'each task' },
            { value: 'on-request', label: 'only when asked' },
          ]}
          value={profile.reports}
          onSelect={set('reports', profile.reports)}
        />
        <Select
          key="escalation"
          label="escalate  "
          options={[{ value: 'on' }, { value: 'off' }]}
          value={profile.escalation ? 'on' : 'off'}
          onSelect={set('escalation', profile.escalation ? 'on' : 'off')}
        />
        <Select
          key="order"
          label="order     "
          options={ORDERS.map(order => ({ value: order.join(','), label: order.join(' > ') }))}
          value={profile.order.join(',')}
          onSelect={set('order', profile.order.join(','))}
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
            onPress={async () => {
              await update($, confirm, () => null)
              await update($, why, shown => !shown)
            }}
          />
          {what === 'changed' && (
            <Button key="reset" label="reset to shipped" onPress={() => act($, io => reset(io, name))} />
          )}
          {what === 'own' && (
            <Button
              key="delete"
              label="delete"
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

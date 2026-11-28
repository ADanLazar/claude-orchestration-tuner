// What a session knows about a plan's progress: which plan is tracked, which
// agent is on which task, and how each task stands. Plain data changed by pure
// functions: no function here changes its input, reads a clock or a file.
import { linkByPrompt, TICKERS } from './plan'
import type { Task } from './plan'

export { TICKERS } from './plan'

export type Tick = { at: number; kind: 'agent' | 'main' | 'fix' }
/** `spent`: the time of this agent's earlier runs on the task; `had`: an agent has been on it this session. */
export type Mark = {
  agent: string | null
  startedAt: number | null
  stoppedAt: number | null
  ticks: Tick[]
  spent?: number
  had?: boolean
}
export type AgentRun = {
  id: string
  type: string
  apart: boolean
  startedAt: number
  endedAt: number | null
  ended: 'completed' | 'failed' | 'stopped' | null
}
export type Tracker = { id: string; title: string; state: string; done: number | null; total: number | null; at: number }
export type Progress = {
  plan: string | null
  label: string
  unread: boolean
  /** Tracked by the person's own command, who may name a plan anywhere: it is re-read without the check. */
  anywhere: boolean
  tasks: Task[]
  marks: Record<string, Mark>
  agents: AgentRun[]
  tracker: Tracker | null
}
export type TaskState = 'waiting' | 'running' | 'done' | 'to check' | 'stopped'

export const NOTHING: Progress = { plan: null, label: '', unread: false, anywhere: false, tasks: [], marks: {}, agents: [], tracker: null }

// Marks and counts are keyed by heading text, and a heading may be `constructor` or `__proto__`:
// every read is of an own key, and every write builds the object.
const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key)
const markOf = (marks: Record<string, Mark>, key: string): Mark | undefined => (has(marks, key) ? marks[key] : undefined)

const isTicker = (type: string): boolean => TICKERS.some(name => type === `tune:${name}`)
const ticked = (task: Task): number => task.steps.filter(Boolean).length
const runOf = (state: Progress, id: string | null): AgentRun | undefined =>
  id === null ? undefined : state.agents.find(agent => agent.id === id)

/** Marks keyed by the tasks still in the file; a key that is gone is dropped. */
const kept = (marks: Record<string, Mark>, tasks: Task[]): Record<string, Mark> =>
  Object.fromEntries(
    tasks.flatMap((task): [string, Mark][] => {
      const mark = markOf(marks, task.key)
      return mark ? [[task.key, mark]] : []
    }),
  )

/** Agent `id` on the task `key`, and off any other. */
function link(marks: Record<string, Mark>, id: string, key: string, now: number): Record<string, Mark> {
  const out = Object.fromEntries(
    Object.entries(marks).map(([other, mark]): [string, Mark] => {
      const last = mark.ticks[mark.ticks.length - 1]
      const off = { ...mark, agent: null, had: true, stoppedAt: last ? last.at : mark.startedAt }
      return [other, other !== key && mark.agent === id ? off : mark]
    }),
  )
  return markOf(out, key)?.agent === id ? out : { ...out, [key]: { agent: id, startedAt: now, stoppedAt: null, ticks: [] } }
}

const running = (agents: AgentRun[], id: string): AgentRun[] =>
  agents.map(agent => (agent.id === id ? { ...agent, endedAt: null, ended: null } : agent))

/** An ended agent that runs again: the clock of its task runs again from `now`, keeping the time already spent. */
const resumed = (marks: Record<string, Mark>, id: string, now: number): Record<string, Mark> =>
  Object.fromEntries(
    Object.entries(marks).map(([key, mark]): [string, Mark] => {
      if (mark.agent !== id || mark.startedAt === null || mark.stoppedAt === null) return [key, mark]
      const spent = (mark.spent ?? 0) + mark.stoppedAt - mark.startedAt
      return [key, { ...mark, spent, startedAt: now, stoppedAt: null }]
    }),
  )

export function track(state: Progress, plan: string, label: string, tasks: Task[], anywhere = false): Progress {
  const marks = plan === state.plan ? kept(state.marks, tasks) : {}
  return { ...state, plan, label, unread: false, anywhere, tasks, marks }
}

export function clear(state: Progress): Progress {
  return { ...NOTHING, agents: state.agents }
}

export function unreadable(state: Progress): Progress {
  return { ...state, unread: true }
}

// Line breaks and other control characters, which would break the one line the item is shown on.
const oneLine = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').slice(0, max) : ''
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export function setTracker(state: Progress, item: unknown, now: number): Progress {
  const given = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
  if (given === null || typeof given.id !== 'string' || given.id === '') throw new Error('tracker needs an id')
  const tracker: Tracker = {
    id: oneLine(given.id, 40),
    title: oneLine(given.title, 80),
    state: oneLine(given.state, 30),
    done: finite(given.done),
    total: finite(given.total),
    at: now,
  }
  return { ...state, tracker }
}

export function agentStarted(
  state: Progress,
  agent: { id: string; type: string; prompt: string; apart: boolean },
  now: number,
): Progress {
  const known = runOf(state, agent.id)
  const agents = known
    ? running(state.agents, agent.id)
    : [...state.agents, { id: agent.id, type: agent.type, apart: agent.apart, startedAt: now, endedAt: null, ended: null }]
  const before = known && known.endedAt !== null ? resumed(state.marks, agent.id, now) : state.marks
  const index = isTicker(agent.type) ? linkByPrompt(state.tasks, agent.prompt) : null
  const task = index === null ? undefined : state.tasks[index]
  const marks = task ? link(before, agent.id, task.key, now) : before
  return { ...state, agents, marks }
}

export function agentEnded(state: Progress, id: string, how: 'completed' | 'failed' | 'stopped', now: number): Progress {
  if (!runOf(state, id)) return state
  const agents = state.agents.map(agent => (agent.id === id ? { ...agent, endedAt: now, ended: how } : agent))
  const marks = Object.fromEntries(
    Object.entries(state.marks).map(([key, mark]) => [key, mark.agent === id ? { ...mark, stoppedAt: now } : mark]),
  )
  return { ...state, agents, marks }
}

export function observe(
  state: Progress,
  tasks: Task[],
  by: { agent: string | null; task: number | null; tick: boolean } | null,
  now: number,
): Progress {
  const before: Record<string, number> = Object.fromEntries(state.tasks.map(task => [task.key, ticked(task)]))
  // A key that is new has no earlier count, so nothing in it counts as a rise.
  const rise = tasks.map(task => (has(before, task.key) ? Math.max(ticked(task) - (before[task.key] ?? 0), 0) : 0))
  let marks = kept(state.marks, tasks)
  let agents = state.agents
  const add = (key: string, kind: Tick['kind'], count: number): void => {
    const mark = markOf(marks, key) ?? { agent: null, startedAt: null, stoppedAt: null, ticks: [] }
    const ticks = [...mark.ticks, ...Array.from({ length: count }, () => ({ at: now, kind }))]
    marks = {
      ...marks,
      [key]: kind === 'main' ? { ...mark, startedAt: mark.startedAt ?? now, stoppedAt: now, ticks } : { ...mark, ticks },
    }
  }

  let own: number | null = null
  const run = by && by.agent !== null ? runOf(state, by.agent) : undefined
  if (by && run && isTicker(run.type)) {
    agents = running(agents, run.id)
    if (run.endedAt !== null) marks = resumed(marks, run.id, now)
    const index = by.task ?? rise.findIndex(count => count > 0)
    const task = tasks[index]
    // An edit that ticked nothing links nothing; a tick a timed read saw first still links.
    if (index >= 0 && task && ((rise[index] ?? 0) > 0 || by.tick)) {
      own = index
      marks = link(marks, run.id, task.key, now)
      const count = rise[index] ?? 0
      if (count > 0) add(task.key, 'agent', count)
    }
  }
  const main = by !== null && by.agent === null
  // An agent that is not a ticking persona corrects: its ticks start no clock.
  const other = by !== null && by.agent !== null && !(run && isTicker(run.type))
  tasks.forEach((task, index) => {
    const count = rise[index] ?? 0
    if (index === own || count === 0) return
    const mark = markOf(marks, task.key)
    const agent = mark?.agent ?? null
    const onIt = agent === null ? undefined : agents.find(each => each.id === agent)
    if (!main && onIt && onIt.endedAt === null) add(task.key, 'agent', count)
    else add(task.key, agent === null && !mark?.had && !other ? 'main' : 'fix', count)
  })
  return { ...state, unread: false, tasks, marks, agents }
}

export function stateOf(state: Progress, key: string): TaskState {
  const task = state.tasks.find(each => each.key === key)
  if (task && task.steps.length > 0 && task.steps.every(Boolean)) return 'done'
  const mark = markOf(state.marks, key)
  const run = mark ? runOf(state, mark.agent) : undefined
  if (run && run.endedAt === null) return 'running'
  if (run?.ended === 'failed' || run?.ended === 'stopped') return 'stopped'
  if (run?.ended === 'completed') return 'to check'
  if (mark?.ticks.some(tick => tick.kind === 'main')) return 'running'
  return 'waiting'
}

export function elapsed(state: Progress, key: string, now: number): number | null {
  const mark = markOf(state.marks, key)
  return !mark || mark.startedAt === null ? null : (mark.spent ?? 0) + (mark.stoppedAt ?? now) - mark.startedAt
}

export type Left = { kind: 'none' } | { kind: 'unknown' } | { kind: 'over' } | { kind: 'about'; ms: number }

/** This run's ticks: an agent's, after the tick that started the clock. */
const counted = (mark: Mark): Tick[] =>
  mark.ticks.filter(tick => tick.kind === 'agent' && mark.startedAt !== null && tick.at > mark.startedAt)

export function left(state: Progress, key: string, now: number): Left {
  const task = state.tasks.find(each => each.key === key)
  const mark = markOf(state.marks, key)
  const run = mark ? runOf(state, mark.agent) : undefined
  if (!task || !mark || mark.startedAt === null || !run || run.endedAt !== null || run.apart) return { kind: 'none' }
  if (stateOf(state, key) === 'done') return { kind: 'none' }
  const open = task.steps.filter(step => !step).length
  const own = counted(mark)
  const last = own[own.length - 1]
  let figure: number
  if (last) {
    figure = ((last.at - mark.startedAt) / own.length) * open - (now - last.at)
  } else {
    let time = 0
    let count = 0
    for (const each of state.tasks) {
      const done = markOf(state.marks, each.key)
      if (!done || done.startedAt === null || stateOf(state, each.key) !== 'done') continue
      const ticks = counted(done)
      const end = ticks[ticks.length - 1]
      if (!end) continue
      time += end.at - done.startedAt
      count += ticks.length
    }
    if (count === 0) return { kind: 'unknown' }
    figure = (time / count) * open - (now - mark.startedAt)
  }
  return figure <= 0 ? { kind: 'over' } : { kind: 'about', ms: figure }
}

export function isRunning(state: Progress): boolean {
  return state.agents.some(agent => agent.endedAt === null)
}

// What a person reads: rows, bars, times and the laid-out lines of the panel and the status.
// Widths are counted in string length, as the row in register.tsx counts them.
export type Row = {
  mark: '·' | '▶' | '✓' | '!' | '✗'
  state: TaskState
  label: string
  done: number
  total: number
  elapsed: string
  left: string
  who: string
}
export type Shown = {
  plan: string | null
  unread: boolean
  tracker: string | null
  tasksDone: number
  tasksTotal: number
  stepsDone: number
  stepsTotal: number
  rows: Row[]
  others: { who: string; elapsed: string }[]
}

const MARKS: Record<TaskState, Row['mark']> = { waiting: '·', running: '▶', done: '✓', 'to check': '!', stopped: '✗' }
const GAP = '   '
const INDENT = '     '
const UNREAD = 'The plan file could not be read; these are the last counts.'
const NO_PLAN = 'No plan is tracked.'
const MINUTE = 60000
const HOUR = 3600000

const clip = (text: string, room: number): string =>
  text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`
const two = (value: number): string => String(value).padStart(2, '0')

export function clock(ms: number): string {
  const time = Math.max(0, Math.floor(ms))
  if (time < HOUR) return `${Math.floor(time / MINUTE)}m${two(Math.floor((time % MINUTE) / 1000))}s`
  return `${Math.floor(time / HOUR)}h${two(Math.floor((time % HOUR) / MINUTE))}m`
}

export function bar(done: number, total: number, width: number): string {
  if (width <= 0) return ''
  const share = total > 0 ? Math.round((done / total) * width) : 0
  const full = done >= total && total > 0 ? width : Math.min(Math.max(share, done > 0 ? 1 : 0), width - 1)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

function leftText(figure: Left): string {
  if (figure.kind === 'none') return ''
  if (figure.kind === 'unknown') return 'no estimate yet'
  if (figure.kind === 'over') return 'longer than estimated'
  const seconds = Math.ceil(figure.ms / 5000) * 5
  if (seconds < 60) return `~${seconds}s left`
  const minutes = Math.max(1, Math.round(figure.ms / MINUTE))
  if (minutes < 60) return `~${minutes}m left`
  return `~${Math.floor(minutes / 60)}h${two(minutes % 60)}m left`
}

const whoOf = (run: AgentRun, levels: Record<string, string>): string => {
  const level = has(levels, run.id) ? levels[run.id] : undefined
  const type = run.type.replace(/^tune:/, '')
  return level ? `${type} ${level}` : type
}

function trackerText(tracker: Tracker, now: number): string {
  const counts = tracker.done !== null && tracker.total !== null ? `${tracker.done} of ${tracker.total}` : ''
  const age = now - tracker.at
  const read = age < MINUTE ? 'read just now' : age < HOUR ? `read ${Math.floor(age / MINUTE)}m ago` : `read ${Math.floor(age / HOUR)}h ago`
  return [tracker.id, tracker.state, tracker.title, counts, read].filter(part => part !== '').join(' · ')
}

export function shown(state: Progress, now: number, levels: Record<string, string> = {}): Shown {
  const rows = state.tasks.map((task): Row => {
    const status = stateOf(state, task.key)
    const time = elapsed(state, task.key, now)
    const run = runOf(state, markOf(state.marks, task.key)?.agent ?? null)
    return {
      mark: MARKS[status],
      state: status,
      label: task.number === null ? task.name : `${task.number} ${task.title}`,
      done: ticked(task),
      total: task.steps.length,
      elapsed: time === null ? '' : clock(time),
      left: leftText(left(state, task.key, now)),
      who: run && run.endedAt === null ? whoOf(run, levels) : '',
    }
  })
  const onTask = new Set(state.tasks.map(task => markOf(state.marks, task.key)?.agent ?? null))
  const others = state.agents
    .filter(run => run.endedAt === null && !onTask.has(run.id))
    .map(run => ({ who: whoOf(run, levels), elapsed: clock(now - run.startedAt) }))
  return {
    plan: state.plan === null ? null : state.label,
    unread: state.unread,
    tracker: state.tracker ? trackerText(state.tracker, now) : null,
    tasksDone: rows.filter(row => row.state === 'done').length,
    tasksTotal: rows.length,
    stepsDone: rows.reduce((sum, row) => sum + row.done, 0),
    stepsTotal: rows.reduce((sum, row) => sum + row.total, 0),
    rows,
    others,
  }
}

/** Cells in columns: each column as wide as its widest cell, the first cut to fit `width`. */
function table(cells: string[][], width: number, lead: string[]): string[] {
  const columns = Math.max(0, ...cells.map(row => row.length))
  const widths = Array.from({ length: columns }, (_, index) => Math.max(0, ...cells.map(row => (row[index] ?? '').length)))
  const rest = widths.slice(1).reduce((sum, each) => sum + GAP.length + each, 0)
  const room = Math.max(1, Math.min(widths[0] ?? 0, width - rest - Math.max(0, ...lead.map(each => each.length))))
  return cells.map((row, index) => {
    const first = clip(row[0] ?? '', room).padEnd(room)
    const tail = row.slice(1).map((cell, column) => cell.padEnd(widths[column + 1] ?? 0))
    return clip(`${lead[index] ?? ''}${[first, ...tail].join(GAP)}`.trimEnd(), width)
  })
}

function agentLines(others: Shown['others'], width: number): string[] {
  return table(others.map(other => [other.who, other.elapsed]), width, [])
}

export function lines(view: Shown, width: number): string[] {
  if (view.plan === null) {
    return view.others.length === 0 ? [NO_PLAN] : [NO_PLAN, '', 'Agents', ...agentLines(view.others, width)]
  }
  const out: string[] = []
  if (view.tracker !== null) out.push(clip(view.tracker, width))
  out.push(clip(`plan: ${view.plan}`, width))
  if (view.unread) out.push(clip(UNREAD, width))
  const all = `All tasks${GAP}${bar(view.stepsDone, view.stepsTotal, 14)}`
  const counts = `${view.tasksDone} of ${view.tasksTotal} done · ${view.stepsDone} of ${view.stepsTotal} steps`
  if (width < 60) out.push(clip(all, width), clip(counts, width))
  else out.push(clip(`${all}${GAP}${counts}`, width))
  out.push('')

  const bars = width >= 60
  const below = width < 44
  const showsBar = (row: Row): boolean => row.state === 'running' || row.state === 'to check' || row.state === 'stopped'
  const cells = view.rows.map(row => [
    row.label,
    ...(bars ? [showsBar(row) ? bar(row.done, row.total, 7) : ''] : []),
    `${row.done}/${row.total}`,
    row.elapsed,
    ...(below ? [] : [row.left]),
  ])
  const taskLines = table(cells, width, view.rows.map(row => `${row.mark} `))
  view.rows.forEach((row, index) => {
    out.push(taskLines[index] ?? '')
    if (below && row.left !== '') out.push(clip(`${INDENT}${row.left}`, width))
    if (row.who !== '') out.push(clip(`${INDENT}${row.who}`, width))
  })
  if (view.others.length > 0) out.push('', 'Other agents', ...agentLines(view.others, width))
  return out
}

export function summary(view: Shown): string {
  if (view.plan === null) return NO_PLAN
  const said = `Tracking ${view.plan}: ${view.tasksDone} of ${view.tasksTotal} tasks done, ${view.stepsDone} of ${view.stepsTotal} steps.`
  return view.unread ? `${said} ${UNREAD}` : said
}

export function count(state: Progress): string | null {
  if (state.plan === null) return null
  const done = state.tasks.filter(task => stateOf(state, task.key) === 'done').length
  return `${done}/${state.tasks.length} tasks`
}

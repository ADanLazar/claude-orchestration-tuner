// What a session knows about a plan's progress: which plan is tracked, which
// agent is on which task, and how each task stands. Plain data changed by pure
// functions: no function here changes its input, reads a clock or a file.
import { linkByPrompt, TICKERS } from './plan'
import type { Task } from './plan'

export { TICKERS } from './plan'

export type Tick = { at: number; kind: 'agent' | 'main' | 'fix' }
export type Mark = { agent: string | null; startedAt: number | null; stoppedAt: number | null; ticks: Tick[] }
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
  tasks: Task[]
  marks: Record<string, Mark>
  agents: AgentRun[]
  tracker: Tracker | null
}
export type TaskState = 'waiting' | 'running' | 'done' | 'to check' | 'stopped'

export const NOTHING: Progress = { plan: null, label: '', unread: false, tasks: [], marks: {}, agents: [], tracker: null }

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
      return [other, other !== key && mark.agent === id ? { ...mark, agent: null, stoppedAt: last ? last.at : mark.startedAt } : mark]
    }),
  )
  return markOf(out, key)?.agent === id ? out : { ...out, [key]: { agent: id, startedAt: now, stoppedAt: null, ticks: [] } }
}

const running = (agents: AgentRun[], id: string): AgentRun[] =>
  agents.map(agent => (agent.id === id ? { ...agent, endedAt: null, ended: null } : agent))

/** An ended agent that runs again: the clock of the task it is on runs again too. */
const resumed = (marks: Record<string, Mark>, id: string): Record<string, Mark> =>
  Object.fromEntries(Object.entries(marks).map(([key, mark]) => [key, mark.agent === id ? { ...mark, stoppedAt: null } : mark]))

export function track(state: Progress, plan: string, label: string, tasks: Task[]): Progress {
  const marks = plan === state.plan ? kept(state.marks, tasks) : {}
  return { ...state, plan, label, unread: false, tasks, marks }
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
  const before = known && known.endedAt !== null ? resumed(state.marks, agent.id) : state.marks
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
  by: { agent: string | null; task: number | null } | null,
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
    if (run.endedAt !== null) marks = resumed(marks, run.id)
    const index = by.task ?? rise.findIndex(count => count > 0)
    const task = tasks[index]
    if (index >= 0 && task) {
      own = index
      marks = link(marks, run.id, task.key, now)
      const count = rise[index] ?? 0
      if (count > 0) add(task.key, 'agent', count)
    }
  }
  const main = by !== null && by.agent === null
  tasks.forEach((task, index) => {
    const count = rise[index] ?? 0
    if (index === own || count === 0) return
    const agent = markOf(marks, task.key)?.agent ?? null
    const onIt = agent === null ? undefined : agents.find(each => each.id === agent)
    if (!main && onIt && onIt.endedAt === null) add(task.key, 'agent', count)
    else add(task.key, agent === null ? 'main' : 'fix', count)
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
  return !mark || mark.startedAt === null ? null : (mark.stoppedAt ?? now) - mark.startedAt
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

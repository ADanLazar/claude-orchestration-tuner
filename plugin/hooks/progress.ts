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

const isTicker = (type: string): boolean => TICKERS.some(name => type === `tune:${name}`)
const ticked = (task: Task): number => task.steps.filter(Boolean).length
const runOf = (state: Progress, id: string | null): AgentRun | undefined =>
  id === null ? undefined : state.agents.find(agent => agent.id === id)

/** Marks keyed by the tasks still in the file; a key that is gone is dropped. */
const kept = (marks: Record<string, Mark>, tasks: Task[]): Record<string, Mark> =>
  Object.fromEntries(tasks.flatMap(task => (marks[task.key] ? [[task.key, marks[task.key]]] : [])))

/** Agent `id` on the task `key`, and off any other. */
function link(marks: Record<string, Mark>, id: string, key: string, now: number): Record<string, Mark> {
  const out: Record<string, Mark> = {}
  for (const [other, mark] of Object.entries(marks)) {
    out[other] =
      other !== key && mark.agent === id
        ? { ...mark, agent: null, stoppedAt: mark.ticks.length > 0 ? mark.ticks[mark.ticks.length - 1].at : mark.startedAt }
        : mark
  }
  if (out[key]?.agent !== id) out[key] = { agent: id, startedAt: now, stoppedAt: null, ticks: [] }
  return out
}

const running = (agents: AgentRun[], id: string): AgentRun[] =>
  agents.map(agent => (agent.id === id ? { ...agent, endedAt: null, ended: null } : agent))

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
  const agents = runOf(state, agent.id)
    ? running(state.agents, agent.id)
    : [...state.agents, { id: agent.id, type: agent.type, apart: agent.apart, startedAt: now, endedAt: null, ended: null }]
  const index = isTicker(agent.type) ? linkByPrompt(state.tasks, agent.prompt) : null
  const marks = index === null ? state.marks : link(state.marks, agent.id, state.tasks[index].key, now)
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
  const before: Record<string, number> = {}
  for (const task of state.tasks) before[task.key] = ticked(task)
  // A key that is new has no earlier count, so nothing in it counts as a rise.
  const rise = tasks.map(task => (task.key in before ? Math.max(ticked(task) - before[task.key], 0) : 0))
  let marks = kept(state.marks, tasks)
  let agents = state.agents
  const add = (key: string, kind: Tick['kind'], count: number): void => {
    const mark = marks[key] ?? { agent: null, startedAt: null, stoppedAt: null, ticks: [] }
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
    const index = by.task ?? rise.findIndex(count => count > 0)
    if (index >= 0 && index < tasks.length) {
      own = index
      marks = link(marks, run.id, tasks[index].key, now)
      if (rise[index] > 0) add(tasks[index].key, 'agent', rise[index])
    }
  }
  const main = by !== null && by.agent === null
  tasks.forEach((task, index) => {
    if (index === own || rise[index] === 0) return
    const agent = marks[task.key]?.agent ?? null
    const onIt = agent === null ? undefined : agents.find(each => each.id === agent)
    if (!main && onIt && onIt.endedAt === null) add(task.key, 'agent', rise[index])
    else add(task.key, agent === null ? 'main' : 'fix', rise[index])
  })
  return { ...state, unread: false, tasks, marks, agents }
}

export function stateOf(state: Progress, key: string): TaskState {
  const task = state.tasks.find(each => each.key === key)
  if (task && task.steps.length > 0 && task.steps.every(Boolean)) return 'done'
  const mark = state.marks[key]
  const run = mark ? runOf(state, mark.agent) : undefined
  if (run && run.endedAt === null) return 'running'
  if (run?.ended === 'failed' || run?.ended === 'stopped') return 'stopped'
  if (run?.ended === 'completed') return 'to check'
  if (mark?.ticks.some(tick => tick.kind === 'main')) return 'running'
  return 'waiting'
}

export function isRunning(state: Progress): boolean {
  return state.agents.some(agent => agent.endedAt === null)
}

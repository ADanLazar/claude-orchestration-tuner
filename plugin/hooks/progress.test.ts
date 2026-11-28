import { expect, test } from 'claude-code/testing'

import { readPlan } from './plan'
import type { Task } from './plan'
import {
  agentEnded,
  agentStarted,
  clear,
  isRunning,
  NOTHING,
  observe,
  setTracker,
  stateOf,
  track,
  unreadable,
} from './progress'
import type { Progress } from './progress'

const PATH = 'docs/plans/export.md'
const ITEM = { id: 'PROJ-12', title: 'Export to CSV', state: 'In Progress', done: 4, total: 9 }

const boxes = (marks: string): string[] => [...marks].map(mark => `- [${mark === 'x' ? 'x' : ' '}] step`)

/** The three-task plan, each argument a box per character: 'x' ticked, anything else open. */
const tasks = (one: string, two: string, three: string): Task[] =>
  readPlan(
    [
      '# Export to CSV',
      '',
      '### Task 1: Read the file',
      ...boxes(one),
      '',
      '### Task 2: Write the rows',
      ...boxes(two),
      '',
      '### Task 3: Tests',
      ...boxes(three),
    ].join('\n'),
    'export.md',
  )

const K1 = 'Task 1: Read the file'
const K2 = 'Task 2: Write the rows'
const K3 = 'Task 3: Tests'
const states = (state: Progress): string[] => state.tasks.map(task => stateOf(state, task.key))
const executor = (id: string, prompt: string) => ({ id, type: 'tune:executor', prompt, apart: false })
const tracked = (): Progress => track(NOTHING, PATH, 'export.md', tasks('   ', '    ', '  '))

test('a tracked plan counts nothing as this session\'s work', () => {
  const state = track(NOTHING, PATH, 'export.md', tasks('xxx', 'xx  ', '  '))

  expect(state.marks).toEqual({})
  expect(state.plan).toBe(PATH)
  expect(state.unread).toBe(false)
  expect(states(state)).toEqual(['done', 'waiting', 'waiting'])
})

test('tracking the same plan again keeps what is known; another plan replaces it', () => {
  let state = setTracker(tracked(), ITEM, 1000)
  state = agentStarted(state, executor('a1', 'Do Task 2 of the plan'), 1000)

  const again = track(state, PATH, 'export.md', tasks('x  ', '    ', '  '))
  expect(again.marks[K2]!.agent).toBe('a1')
  expect(again.tasks[0]!.steps).toEqual([true, false, false])
  expect(again.marks[K1]).toBe(undefined)
  expect(again.tracker?.id).toBe('PROJ-12')

  const other = track(again, 'docs/plans/other.md', 'other.md', tasks('   ', '    ', '  '))
  expect(other.marks).toEqual({})
  expect(other.plan).toBe('docs/plans/other.md')
  expect(other.agents.map(agent => agent.id)).toEqual(['a1'])
  expect(other.tracker?.id).toBe('PROJ-12')
})

test('Task N in a ticking persona\'s prompt links it', () => {
  const state = agentStarted(tracked(), executor('a1', 'Do Task 2 of the plan'), 1000)
  expect(stateOf(state, K2)).toBe('running')
  expect(state.marks[K2]!.agent).toBe('a1')
  expect(state.marks[K2]!.startedAt).toBe(1000)
  expect(isRunning(state)).toBe(true)

  const both = agentStarted(tracked(), executor('a2', 'Do Task 1 and Task 2'), 1000)
  expect(both.marks).toEqual({})
  expect(both.agents.length).toBe(1)

  const reviewer = agentStarted(tracked(), { id: 'r1', type: 'tune:code-reviewer', prompt: 'Review Task 2', apart: false }, 1000)
  expect(reviewer.marks).toEqual({})

  const ended = agentEnded(state, 'a1', 'completed', 2000)
  expect(isRunning(ended)).toBe(false)
  const again = agentStarted(ended, executor('a1', 'Go on'), 3000)
  expect(again.agents.length).toBe(1)
  expect(again.agents[0]!.endedAt).toBe(null)
  expect(again.agents[0]!.ended).toBe(null)
  expect(stateOf(again, K2)).toBe('running')
})

test('an agent that ran, ended and runs again has a running clock', () => {
  const started = agentStarted(tracked(), executor('a1', 'Do Task 1'), 1000)
  const ended = agentEnded(started, 'a1', 'completed', 5000)
  expect(ended.marks[K1]!.stoppedAt).toBe(5000)

  const again = agentStarted(ended, executor('a1', 'Go on'), 9000)
  expect(again.marks[K1]!.stoppedAt).toBe(null)
  expect(again.marks[K1]!.startedAt).toBe(1000)
  expect(stateOf(again, K1)).toBe('running')

  const edited = observe(ended, tasks('x  ', '    ', '  '), { agent: 'a1', task: 0 }, 9000)
  expect(edited.marks[K1]!.stoppedAt).toBe(null)
  expect(edited.marks[K1]!.startedAt).toBe(1000)
  expect(stateOf(edited, K1)).toBe('running')
  expect(edited.marks[K1]!.ticks).toEqual([{ at: 9000, kind: 'agent' }])
})

test('a tick by an agent links it to that task, and that wins', () => {
  let state = agentStarted(tracked(), executor('a1', 'Do Task 1'), 1000)
  state = observe(state, tasks('   ', 'x   ', '  '), { agent: 'a1', task: 1 }, 2000)

  expect(state.marks[K2]!.agent).toBe('a1')
  expect(state.marks[K2]!.ticks).toEqual([{ at: 2000, kind: 'agent' }])
  expect(state.marks[K1]!.agent).toBe(null)
  expect(state.marks[K1]!.stoppedAt).toBe(1000)
  expect(states(state)).toEqual(['waiting', 'running', 'waiting'])
})

test('how the agent ended decides the state', () => {
  const started = agentStarted(tracked(), executor('a1', 'Do Task 2'), 1000)

  expect(stateOf(agentEnded(started, 'a1', 'completed', 2000), K2)).toBe('to check')
  expect(stateOf(agentEnded(started, 'a1', 'failed', 2000), K2)).toBe('stopped')
  expect(stateOf(agentEnded(started, 'a1', 'stopped', 2000), K2)).toBe('stopped')
  expect(agentEnded(started, 'a1', 'completed', 2000).marks[K2]!.stoppedAt).toBe(2000)

  const ticked = observe(started, tasks('   ', 'xxxx', '  '), { agent: 'a1', task: 1 }, 1500)
  for (const how of ['completed', 'failed', 'stopped'] as const) {
    expect(stateOf(agentEnded(ticked, 'a1', how, 2000), K2)).toBe('done')
  }
})

test('to check clears when every box is ticked or another agent is linked', () => {
  let state = agentStarted(tracked(), executor('a1', 'Do Task 2'), 1000)
  state = observe(state, tasks('   ', 'xx  ', '  '), { agent: 'a1', task: 1 }, 1500)
  state = agentEnded(state, 'a1', 'completed', 2000)
  expect(stateOf(state, K2)).toBe('to check')

  const fixed = observe(state, tasks('   ', 'xxxx', '  '), { agent: null, task: 1 }, 3000)
  expect(stateOf(fixed, K2)).toBe('done')
  expect(fixed.marks[K2]!.ticks.map(tick => tick.kind)).toEqual(['agent', 'agent', 'fix', 'fix'])

  const second = agentStarted(state, executor('a2', 'Do Task 2 again'), 4000)
  expect(stateOf(second, K2)).toBe('running')
  expect(second.marks[K2]).toEqual({ agent: 'a2', startedAt: 4000, stoppedAt: null, ticks: [] })
})

test('a task the main conversation works itself', () => {
  let state = observe(tracked(), tasks('x  ', '    ', '  '), { agent: null, task: 0 }, 5000)
  expect(stateOf(state, K1)).toBe('running')
  expect(state.marks[K1]).toEqual({ agent: null, startedAt: 5000, stoppedAt: 5000, ticks: [{ at: 5000, kind: 'main' }] })

  state = observe(state, tasks('xx ', '    ', '  '), { agent: null, task: 0 }, 65000)
  expect(state.marks[K1]!.startedAt).toBe(5000)
  expect(state.marks[K1]!.stoppedAt).toBe(65000)
  expect(state.marks[K1]!.ticks.length).toBe(2)
})

test('a tick nobody\'s edit explains', () => {
  const started = agentStarted(tracked(), executor('a1', 'Do Task 2'), 1000)
  const state = observe(started, tasks('x  ', 'x   ', '  '), null, 2000)

  expect(state.marks[K2]!.ticks).toEqual([{ at: 2000, kind: 'agent' }])
  expect(state.marks[K1]!.ticks).toEqual([{ at: 2000, kind: 'main' }])
  expect(state.marks[K1]!.agent).toBe(null)
})

test('two agents tick between two reads', () => {
  let state = agentStarted(tracked(), executor('A', 'Do Task 1'), 1000)
  state = agentStarted(state, executor('B', 'Do Task 2'), 1000)
  state = observe(state, tasks('x  ', 'x   ', '  '), { agent: 'A', task: 0 }, 2000)

  expect(state.marks[K1]!.agent).toBe('A')
  expect(state.marks[K1]!.ticks).toEqual([{ at: 2000, kind: 'agent' }])
  expect(state.marks[K2]!.agent).toBe('B')
  expect(state.marks[K2]!.ticks).toEqual([{ at: 2000, kind: 'agent' }])
})

test('the plan changes while it is tracked', () => {
  let state = agentStarted(tracked(), executor('A', 'Do Task 1'), 1000)
  state = agentStarted(state, executor('B', 'Do Task 2'), 1100)
  state = observe(state, tasks('x  ', '    ', '  '), { agent: 'A', task: 0 }, 2000)
  const before = state.marks[K1]!.ticks.length

  const changed = readPlan(
    [
      '# Export to CSV',
      '',
      '### Task 0: Set up',
      '- [ ] step',
      '',
      '### Task 1: Read the file',
      ...boxes('   '),
      '',
      '### Task 2: Write the rows',
      ...boxes('    '),
      '',
      '### Task 3: Tests and checks',
      ...boxes('  '),
    ].join('\n'),
    'export.md',
  )
  let after = state
  expect(() => {
    after = observe(state, changed, null, 3000)
  }).not.toThrow()

  expect(after.marks[K1]!.agent).toBe('A')
  expect(after.marks[K1]!.startedAt).toBe(1000)
  expect(after.marks[K1]!.ticks.length).toBe(before)
  expect(after.marks[K2]!.agent).toBe('B')
  expect(after.marks[K2]!.startedAt).toBe(1100)
  expect(after.marks['Task 3: Tests and checks']).toBe(undefined)
  expect(after.marks[K3]).toBe(undefined)
  expect(after.tasks.length).toBe(4)
})

test('the tracker item is kept as given, cut to one line', () => {
  const state = setTracker(NOTHING, ITEM, 7000)
  expect(state.tracker).toEqual({ ...ITEM, at: 7000 })

  const long = setTracker(NOTHING, { id: 'PROJ-12', title: `${'a'.repeat(250)}\n${'b'.repeat(249)}` }, 7000)
  expect(long.tracker?.title.length).toBe(80)
  expect(long.tracker?.title).not.toMatch(/[\n\r]/)
  expect(long.tracker?.state).toBe('')

  expect(setTracker(NOTHING, { ...ITEM, done: 'four' }, 7000).tracker?.done).toBe(null)
  expect(() => setTracker(NOTHING, { title: 'x' }, 7000)).toThrow('tracker needs an id')
  expect(() => setTracker(NOTHING, 'PROJ-12', 7000)).toThrow('tracker needs an id')
})

test('clear forgets the plan and the tracker and keeps the agents', () => {
  let state = setTracker(tracked(), ITEM, 1000)
  state = agentStarted(state, executor('a1', 'Do Task 2'), 1000)
  const cleared = clear(state)

  expect(cleared.plan).toBe(null)
  expect(cleared.tasks).toEqual([])
  expect(cleared.marks).toEqual({})
  expect(cleared.tracker).toBe(null)
  expect(cleared.agents.map(agent => agent.id)).toEqual(['a1'])
})

test('unreadable keeps the last counts', () => {
  const state = track(NOTHING, PATH, 'export.md', tasks('x  ', '    ', '  '))
  const lost = unreadable(state)

  expect(lost.unread).toBe(true)
  expect(lost.tasks).toEqual(state.tasks)
  expect(lost.plan).toBe(PATH)
  expect(observe(lost, state.tasks, null, 1000).unread).toBe(false)
})

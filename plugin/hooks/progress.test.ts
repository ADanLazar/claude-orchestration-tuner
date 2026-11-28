import { expect, test } from 'claude-code/testing'

import { readPlan } from './plan'
import type { Task } from './plan'
import {
  agentEnded,
  agentStarted,
  bar,
  clear,
  clock,
  count,
  elapsed,
  isRunning,
  left,
  lines,
  NOTHING,
  observe,
  setTracker,
  shown,
  stateOf,
  summary,
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

const endedAfterRun = (): Progress => agentEnded(agentStarted(tracked(), executor('a1', 'Do Task 1'), 1000), 'a1', 'completed', 5000)

test('a resumed agent\'s time leaves out the gap', () => {
  const ended = endedAfterRun()
  expect(elapsed(ended, K1, 8000)).toBe(4000)

  const again = agentStarted(ended, executor('a1', 'Go on'), 9000)
  expect(stateOf(again, K1)).toBe('running')
  expect(elapsed(again, K1, 9000)).toBe(4000)
  expect(elapsed(again, K1, 12000)).toBe(7000)

  const over = agentEnded(again, 'a1', 'completed', 13000)
  expect(elapsed(over, K1, 20000)).toBe(8000)
})

test('the same when a tick resumes it', () => {
  const edited = observe(endedAfterRun(), tasks('x  ', '    ', '  '), { agent: 'a1', task: 0, tick: true }, 9000)
  expect(stateOf(edited, K1)).toBe('running')
  expect(elapsed(edited, K1, 12000)).toBe(7000)
  expect(edited.marks[K1]!.ticks).toEqual([{ at: 9000, kind: 'agent' }])
})

test('a resumed agent\'s estimate uses this run\'s pace', () => {
  let state = agentStarted(from('     '), executor('a1', 'Do Task 1'), 0)
  state = tick(state, 'a1', 10000, 'x    ')
  state = tick(state, 'a1', 20000, 'xx   ')
  state = agentEnded(state, 'a1', 'completed', 20000)
  state = agentStarted(state, executor('a1', 'Go on'), 100000)
  state = tick(state, 'a1', 104000, 'xxx  ')
  expect(left(state, K1, 104000)).toEqual({ kind: 'about', ms: 8000 })
})

test('a correction after the agent moved on adds no time', () => {
  let state = agentStarted(tracked(), executor('A', 'Do Task 1'), 0)
  state = observe(state, tasks('x  ', '    ', '  '), { agent: 'A', task: 0, tick: true }, 30000)
  state = observe(state, tasks('xx ', '    ', '  '), { agent: 'A', task: 0, tick: true }, 60000)
  state = observe(state, tasks('xx ', 'x   ', '  '), { agent: 'A', task: 1, tick: true }, 100000)
  state = observe(state, tasks('xxx', 'x   ', '  '), { agent: null, task: 0, tick: true }, 3600000)

  expect(stateOf(state, K1)).toBe('done')
  expect(state.marks[K1]!.ticks[state.marks[K1]!.ticks.length - 1]!.kind).toBe('fix')
  expect(elapsed(state, K1, 3600000)).toBe(60000)
})

test('an edit that ticks nothing links nothing', () => {
  const started = agentStarted(tracked(), executor('a1', 'Do Task 2'), 1000)
  const state = observe(started, started.tasks, { agent: 'a1', task: 2, tick: false }, 2000)

  expect(state.marks[K2]!.agent).toBe('a1')
  expect(stateOf(state, K2)).toBe('running')
  expect(stateOf(state, K3)).toBe('waiting')
})

test('a tick seen first by a timed read still links the agent', () => {
  let state = agentStarted(tracked(), executor('a1', 'Do Task 1'), 1000)
  state = observe(state, tasks('   ', 'x   ', '  '), null, 2000)
  state = observe(state, state.tasks, { agent: 'a1', task: 1, tick: true }, 2100)

  expect(state.marks[K2]!.agent).toBe('a1')
  expect(state.marks[K1]!.agent).toBe(null)
})

test('another agent\'s tick moves the count and starts no clock', () => {
  const state = observe(tracked(), tasks('x  ', '    ', '  '), { agent: 'x9', task: 0, tick: true }, 2000)

  expect(stateOf(state, K1)).toBe('waiting')
  expect(state.tasks[0]!.steps.filter(Boolean).length).toBe(1)
  expect(elapsed(state, K1, 3000)).toBe(null)
})

test('a tick by an agent links it to that task, and that wins', () => {
  let state = agentStarted(tracked(), executor('a1', 'Do Task 1'), 1000)
  state = observe(state, tasks('   ', 'x   ', '  '), { agent: 'a1', task: 1, tick: true }, 2000)

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

  const ticked = observe(started, tasks('   ', 'xxxx', '  '), { agent: 'a1', task: 1, tick: true }, 1500)
  for (const how of ['completed', 'failed', 'stopped'] as const) {
    expect(stateOf(agentEnded(ticked, 'a1', how, 2000), K2)).toBe('done')
  }
})

test('to check clears when every box is ticked or another agent is linked', () => {
  let state = agentStarted(tracked(), executor('a1', 'Do Task 2'), 1000)
  state = observe(state, tasks('   ', 'xx  ', '  '), { agent: 'a1', task: 1, tick: true }, 1500)
  state = agentEnded(state, 'a1', 'completed', 2000)
  expect(stateOf(state, K2)).toBe('to check')

  const fixed = observe(state, tasks('   ', 'xxxx', '  '), { agent: null, task: 1, tick: true }, 3000)
  expect(stateOf(fixed, K2)).toBe('done')
  expect(fixed.marks[K2]!.ticks.map(tick => tick.kind)).toEqual(['agent', 'agent', 'fix', 'fix'])

  const second = agentStarted(state, executor('a2', 'Do Task 2 again'), 4000)
  expect(stateOf(second, K2)).toBe('running')
  expect(second.marks[K2]).toEqual({ agent: 'a2', startedAt: 4000, stoppedAt: null, ticks: [] })
})

test('a task the main conversation works itself', () => {
  let state = observe(tracked(), tasks('x  ', '    ', '  '), { agent: null, task: 0, tick: true }, 5000)
  expect(stateOf(state, K1)).toBe('running')
  expect(state.marks[K1]).toEqual({ agent: null, startedAt: 5000, stoppedAt: 5000, ticks: [{ at: 5000, kind: 'main' }] })

  state = observe(state, tasks('xx ', '    ', '  '), { agent: null, task: 0, tick: true }, 65000)
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
  state = observe(state, tasks('x  ', 'x   ', '  '), { agent: 'A', task: 0, tick: true }, 2000)

  expect(state.marks[K1]!.agent).toBe('A')
  expect(state.marks[K1]!.ticks).toEqual([{ at: 2000, kind: 'agent' }])
  expect(state.marks[K2]!.agent).toBe('B')
  expect(state.marks[K2]!.ticks).toEqual([{ at: 2000, kind: 'agent' }])
})

test('the plan changes while it is tracked', () => {
  let state = agentStarted(tracked(), executor('A', 'Do Task 1'), 1000)
  state = agentStarted(state, executor('B', 'Do Task 2'), 1100)
  state = observe(state, tasks('x  ', '    ', '  '), { agent: 'A', task: 0, tick: true }, 2000)
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

test('who tracked the plan is kept', () => {
  const plan = tasks('   ', '    ', '  ')

  expect(track(NOTHING, PATH, 'export.md', plan).anywhere).toBe(false)
  expect(track(NOTHING, PATH, 'export.md', plan, true).anywhere).toBe(true)
  expect(clear(track(NOTHING, PATH, 'export.md', plan, true)).anywhere).toBe(false)
})

test('a task may be named like a built-in', () => {
  const plan = (one: string, two: string): Task[] =>
    readPlan(['## constructor', ...boxes(one), '', '## __proto__', ...boxes(two)].join('\n'), 'odd.md')
  const quiet = track(NOTHING, 'docs/plans/odd.md', 'odd.md', plan('   ', '  '))
  expect(quiet.tasks.map(task => task.key)).toEqual(['constructor', '__proto__'])

  let state = agentStarted(quiet, executor('a1', 'Go'), 1000)
  state = observe(state, plan('x  ', '  '), { agent: 'a1', task: 0, tick: true }, 2000)
  state = observe(state, plan('x  ', 'x '), { agent: null, task: 1, tick: true }, 3000)

  expect(stateOf(state, 'constructor')).toBe('running')
  expect(stateOf(state, '__proto__')).toBe('running')
  expect(Object.keys(state.marks)).toEqual(['constructor', '__proto__'])
  expect(state.marks['constructor']!.agent).toBe('a1')
  expect(state.marks['constructor']!.ticks).toEqual([{ at: 2000, kind: 'agent' }])
  expect(state.marks['__proto__']!.ticks).toEqual([{ at: 3000, kind: 'main' }])
  for (const key of ['constructor', '__proto__']) {
    expect(elapsed(quiet, key, 4000)).toBe(null)
    expect(left(quiet, key, 4000)).toEqual({ kind: 'none' })
  }

  state = observe(state, plan('xx ', 'x '), { agent: 'a1', task: 0, tick: true }, 6000)
  expect(elapsed(state, 'constructor', 6000)).toBe(4000)
  expect(left(state, 'constructor', 6000)).toEqual({ kind: 'about', ms: 4000 })
  state = observe(state, plan('xxx', 'x '), { agent: 'a1', task: 0, tick: true }, 6000)
  expect(stateOf(state, 'constructor')).toBe('done')
  expect(elapsed(state, 'constructor', 6000)).toBe(4000)

  expect(() => {
    expect(stateOf(quiet, 'constructor')).toBe('waiting')
    expect(stateOf(quiet, '__proto__')).toBe('waiting')
  }).not.toThrow()
})

test('unreadable keeps the last counts', () => {
  const state = track(NOTHING, PATH, 'export.md', tasks('x  ', '    ', '  '))
  const lost = unreadable(state)

  expect(lost.unread).toBe(true)
  expect(lost.tasks).toEqual(state.tasks)
  expect(lost.plan).toBe(PATH)
  expect(observe(lost, state.tasks, null, 1000).unread).toBe(false)
})

const TITLES = ['Read the file', 'Write the rows', 'Tests']
/** A plan of up to three tasks, each argument a box per character as in `tasks`. */
const plan = (...each: string[]): Task[] =>
  readPlan(each.map((marks, index) => [`### Task ${index + 1}: ${TITLES[index]}`, ...boxes(marks)].join('\n')).join('\n\n'), 'export.md')
const from = (...each: string[]): Progress => track(NOTHING, PATH, 'export.md', plan(...each))
const tick = (state: Progress, agent: string | null, at: number, ...each: string[]): Progress =>
  observe(state, plan(...each), { agent, task: 0, tick: true }, at)

test('time taken runs while the agent runs and stops when it ends', () => {
  const started = agentStarted(from('    '), executor('a1', 'Do Task 1'), 1000)
  expect(elapsed(started, K1, 49000)).toBe(48000)
  const ended = agentEnded(started, 'a1', 'completed', 131000)
  expect(elapsed(ended, K1, 131000)).toBe(130000)
  expect(elapsed(ended, K1, 900000)).toBe(130000)

  let main = tick(from('    '), null, 5000, 'x   ')
  main = tick(main, null, 65000, 'xx  ')
  expect(elapsed(main, K1, 900000)).toBe(60000)

  expect(elapsed(from('    '), K1, 900000)).toBe(null)
})

test('the estimate is this run\'s pace times the steps left', () => {
  const started = agentStarted(from('     '), executor('a1', 'Do Task 1'), 0)
  const one = tick(started, 'a1', 10000, 'x    ')
  expect(left(one, K1, 10000)).toEqual({ kind: 'about', ms: 40000 })
  expect(left(one, K1, 25000)).toEqual({ kind: 'about', ms: 25000 })

  const two = tick(one, 'a1', 20000, 'xx   ')
  expect(left(two, K1, 20000)).toEqual({ kind: 'about', ms: 30000 })
})

test('it reads over when it runs out', () => {
  const state = tick(agentStarted(from('     '), executor('a1', 'Do Task 1'), 0), 'a1', 10000, 'x    ')
  expect(left(state, K1, 50000)).toEqual({ kind: 'over' })
  expect(left(state, K1, 60000)).toEqual({ kind: 'over' })
})

test('boxes ticked before this run are not counted', () => {
  const started = agentStarted(from('xxx    '), executor('a1', 'Do Task 1'), 0)
  const state = tick(started, 'a1', 30000, 'xxxx   ')
  expect(left(state, K1, 30000)).toEqual({ kind: 'about', ms: 90000 })
})

test('the tick that starts a clock is not counted', () => {
  const first = tick(agentStarted(from('    '), executor('a1', 'Go on'), 0), 'a1', 12000, 'x   ')
  expect(first.marks[K1]!.startedAt).toBe(12000)
  expect(left(first, K1, 12000)).toEqual({ kind: 'unknown' })

  const second = tick(first, 'a1', 20000, 'xx  ')
  expect(left(second, K1, 20000)).toEqual({ kind: 'about', ms: 16000 })
})

test('before the first tick the pace of finished tasks is used', () => {
  let state = agentStarted(from('    ', '      '), executor('a1', 'Do Task 1'), 0)
  for (const [at, marks] of [[10000, 'x   '], [20000, 'xx  '], [30000, 'xxx '], [40000, 'xxxx']] as const) {
    state = tick(state, 'a1', at, marks, '      ')
  }
  state = agentEnded(state, 'a1', 'completed', 41000)
  expect(stateOf(state, K1)).toBe('done')
  state = agentStarted(state, executor('a2', 'Do Task 2'), 50000)
  expect(left(state, K2, 60000)).toEqual({ kind: 'about', ms: 50000 })

  const alone = agentStarted(from('    ', '      '), executor('a2', 'Do Task 2'), 50000)
  expect(left(alone, K2, 60000)).toEqual({ kind: 'unknown' })
})

test('a correction changes the steps left, not the pace', () => {
  const one = tick(agentStarted(from('     '), executor('a1', 'Do Task 1'), 0), 'a1', 10000, 'x    ')
  expect(left(one, K1, 10000)).toEqual({ kind: 'about', ms: 40000 })

  const fixed = tick(one, null, 10000, 'xx   ')
  expect(fixed.marks[K1]!.ticks.map(each => each.kind)).toEqual(['agent', 'fix'])
  expect(left(fixed, K1, 10000)).toEqual({ kind: 'about', ms: 30000 })
})

test('no estimate where no agent is at work', () => {
  const main = tick(from('    '), null, 5000, 'x   ')
  expect(left(main, K1, 6000)).toEqual({ kind: 'none' })

  const started = tick(agentStarted(from('    '), executor('a1', 'Do Task 1'), 0), 'a1', 10000, 'x   ')
  const toCheck = agentEnded(started, 'a1', 'completed', 11000)
  expect(stateOf(toCheck, K1)).toBe('to check')
  expect(left(toCheck, K1, 12000)).toEqual({ kind: 'none' })

  const done = tick(started, 'a1', 20000, 'xxxx')
  expect(stateOf(done, K1)).toBe('done')
  expect(left(done, K1, 20000)).toEqual({ kind: 'none' })

  const apart = agentStarted(from('    '), { ...executor('a1', 'Do Task 1'), apart: true }, 0)
  const away = observe(apart, plan('x   '), null, 10000)
  expect(away.marks[K1]!.agent).toBe('a1')
  expect(left(away, K1, 10000)).toEqual({ kind: 'none' })
})

// The view's fixture: Task 1 done by a1, Task 2 under way by a2, a reviewer on no task.
const NOW = 166000
const LEVELS = { a2: 'sonnet / medium', a3: 'opus / medium' }
const reviewer = (id: string) => ({ id, type: 'tune:code-reviewer', prompt: 'Review the diff', apart: false })
const SCENE = ((): Progress => {
  let state = track(NOTHING, PATH, PATH, tasks('   ', '    ', '  '))
  state = setTracker(state, { id: 'PROJ-12', title: 'Export to CSV', state: 'In Progress' }, NOW - 12 * 60000)
  state = agentStarted(state, executor('a1', 'Do Task 1 of the plan'), 0)
  state = observe(state, tasks('x  ', '    ', '  '), { agent: 'a1', task: 0, tick: true }, 40000)
  state = observe(state, tasks('xx ', '    ', '  '), { agent: 'a1', task: 0, tick: true }, 80000)
  state = observe(state, tasks('xxx', '    ', '  '), { agent: 'a1', task: 0, tick: true }, 130000)
  state = agentEnded(state, 'a1', 'completed', 130000)
  state = agentStarted(state, executor('a2', 'Do Task 2 of the plan'), 130000)
  state = agentStarted(state, reviewer('a3'), 131000)
  state = observe(state, tasks('xxx', 'x   ', '  '), { agent: 'a2', task: 1, tick: true }, 148000)
  return observe(state, tasks('xxx', 'xx  ', '  '), { agent: 'a2', task: 1, tick: true }, 166000)
})()
const isTaskLine = (line: string): boolean => /^[·▶✓!✗] /.test(line)

test('clock and bar read as a person says them', () => {
  expect(clock(48000)).toBe('0m48s')
  expect(clock(130000)).toBe('2m10s')
  expect(clock(3900000)).toBe('1h05m')
  expect(bar(4, 7, 7)).toBe('████░░░')
  expect(bar(0, 5, 7)).toBe('░░░░░░░')
  expect(bar(5, 5, 7)).toBe('███████')
  expect(bar(1, 41, 14).split('█').length - 1).toBe(1)
  expect(bar(40, 41, 14).split('█').length - 1).toBe(13)
})

test('shown counts tasks and steps and marks each task', () => {
  const view = shown(SCENE, NOW, LEVELS)
  expect([view.tasksDone, view.tasksTotal, view.stepsDone, view.stepsTotal]).toEqual([1, 3, 5, 9])
  expect(view.rows.map(row => row.mark)).toEqual(['✓', '▶', '·'])
  expect(view.rows.map(({ label, done, total, elapsed, left, who }) => ({ label, done, total, elapsed, left, who }))).toEqual([
    { label: '1 Read the file', done: 3, total: 3, elapsed: '2m10s', left: '', who: '' },
    { label: '2 Write the rows', done: 2, total: 4, elapsed: '0m36s', left: '~40s left', who: 'executor sonnet / medium' },
    { label: '3 Tests', done: 0, total: 2, elapsed: '', left: '', who: '' },
  ])
  expect(view.others).toEqual([{ who: 'code-reviewer opus / medium', elapsed: '0m35s' }])
  expect(view.tracker).toBe('PROJ-12 · In Progress · Export to CSV · read 12m ago')
  expect(view.plan).toBe(PATH)
})

test('the estimate and the tracker\'s age in words', () => {
  const leftAt = (state: Progress, now: number): string => shown(state, now).rows[1]!.left
  const linked = agentStarted(tracked(), executor('a2', 'Do Task 2'), 0)
  const shortOne = observe(linked, tasks('   ', 'x   ', '  '), { agent: 'a2', task: 1, tick: true }, 20000)
  expect(leftAt(shortOne, 28000)).toBe('~55s left')
  const longOne = observe(linked, tasks('   ', 'x   ', '  '), { agent: 'a2', task: 1, tick: true }, 80000)
  expect(leftAt(longOne, 80000)).toBe('~4m left')
  expect(leftAt(linked, 1000)).toBe('no estimate yet')
  expect(leftAt(shortOne, 90000)).toBe('longer than estimated')

  expect(shown(setTracker(SCENE, ITEM, NOW - 20000), NOW).tracker).toMatch(/ · read just now$/)
  expect(shown(setTracker(SCENE, ITEM, NOW - 2 * 3600000), NOW).tracker).toMatch(/ · read 2h ago$/)
  expect(shown(setTracker(SCENE, ITEM, NOW), NOW).tracker).toContain('· 4 of 9 ·')
})

test('lines lays the view out', () => {
  const out = lines(shown(SCENE, NOW, LEVELS), 80)
  const wanted = [
    /^PROJ-12 · In Progress · Export to CSV · read 12m ago$/,
    /^plan: docs\/plans\/export\.md$/,
    /^All tasks\s+████████░░░░░░\s+1 of 3 done · 5 of 9 steps$/,
    /^✓ 1 Read the file\s+3\/3\s+2m10s$/,
    /^▶ 2 Write the rows\s+████░░░\s+2\/4\s+0m36s\s+~40s left$/,
    /^ {5}executor sonnet \/ medium$/,
    /^· 3 Tests\s+0\/2$/,
    /^Other agents$/,
    /^code-reviewer opus \/ medium\s+0m35s$/,
  ]
  let at = 0
  for (const pattern of wanted) {
    const found = out.findIndex((line, index) => index >= at && pattern.test(line))
    expect(found).toBeGreaterThanOrEqual(at)
    at = found + 1
  }
})

test('no line is wider than the pane', () => {
  const long = setTracker(
    track(SCENE, PATH, PATH, SCENE.tasks.map((task, index) => (index === 0 ? { ...task, title: 'Read '.repeat(30) } : task))),
    { ...ITEM, title: 'Export '.repeat(20) },
    NOW,
  )
  for (const state of [SCENE, long]) {
    for (const width of [30, 48, 80]) {
      const out = lines(shown(state, NOW, LEVELS), width)
      for (const line of out) expect(line.length).toBeLessThanOrEqual(width)
      if (width === 48) expect(out.filter(isTaskLine).some(line => line.includes('█'))).toBe(false)
      expect(out.join('\n')).toContain('1 of 3 done')
      expect(out.join('\n')).toContain('2/4')
    }
  }
})

test('with no plan it says so and lists the running agents', () => {
  expect(lines(shown(NOTHING, NOW), 80)).toEqual(['No plan is tracked.'])
  const out = lines(shown(agentStarted(NOTHING, reviewer('a3'), 131000), NOW, LEVELS), 80)
  expect(out).toContain('Agents')
  expect(out.join('\n')).toContain('code-reviewer opus / medium')
})

test('an unreadable plan is said', () => {
  expect(lines(shown(unreadable(SCENE), NOW), 80)).toContain('The plan file could not be read; these are the last counts.')
})

test('summary and count', () => {
  expect(summary(shown(SCENE, NOW))).toBe('Tracking docs/plans/export.md: 1 of 3 tasks done, 5 of 9 steps.')
  expect(summary(shown(NOTHING, NOW))).toBe('No plan is tracked.')
  expect(count(SCENE)).toBe('1/3 tasks')
  expect(count(NOTHING)).toBe(null)
})

// The tool that names the tracked plan, and the re-reads of the plan after an edit and a prompt.
import { expect, mock, test } from 'claude-code/testing'

import { fake, makeIo, PLAN_PATH, PLAN_TEXT, ROOT, START } from './kit'

const tune = async ($: any, input: Record<string, unknown> = {}): Promise<string> =>
  String((await $.tool.call({ tool: 'mcp__tune__progress', ...input } as any)).result)
const tick = ($: any, step: string) =>
  $.tool.call({ tool: 'Edit', file_path: PLAN_PATH, old_string: `- [ ] ${step}`, new_string: `- [x] ${step}` } as any)

const START_COUNTS = 'Tracking docs/plans/export.md: 0 of 3 tasks done, 0 of 9 steps.'

test('the tool is registered in front of tool search', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  const spec = world.tools[0]!
  expect(spec.name).toBe('progress')
  expect(spec.isDeferred).toBe(false)
  expect(Object.keys(spec.inputSchema.properties)).toEqual(['plan', 'tracker', 'clear'])
})

test('giving the tool a plan tracks it and answers the counts', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  expect(await tune($, { plan: 'docs/plans/export.md' })).toBe(START_COUNTS)
})

test('an edit of the plan is seen at once', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })

  const edited = await tick($, 'Open the file')
  expect(edited.result).toBe('edited')
  expect(await tune($)).toBe('Tracking docs/plans/export.md: 0 of 3 tasks done, 1 of 9 steps.')
})

test('an edit of another file reads nothing', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files['/work/src/a.ts'] = 'const a = 1\n'
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })

  const before = world.reads.filter(path => path === PLAN_PATH).length
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'a = 1', new_string: 'a = 2' } as any)
  expect(world.reads.filter(path => path === PLAN_PATH).length).toBe(before)
})

test('a prompt re-reads the plan', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })

  world.files[PLAN_PATH] = PLAN_TEXT.replace('- [ ] Open the file', '- [x] Open the file').replace(
    '- [ ] Parse the rows',
    '- [x] Parse the rows',
  )
  const sent = await $.prompt.submit({ text: 'go' } as any)
  expect(sent.text).toBe('go')
  expect(await tune($)).toContain('2 of 9 steps')
})

test('another plan replaces the tracked one; clear stops tracking', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files['/work/docs/plans/other.md'] = '# Other\n\n### Task 1: One thing\n\n- [ ] First\n- [ ] Second\n'
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })

  expect(await tune($, { plan: 'docs/plans/other.md' })).toContain('0 of 1 tasks done, 0 of 2 steps')
  expect(await tune($, { clear: true })).toBe('Nothing is tracked now.')
  expect(await tune($)).toBe('No plan is tracked.')
})

test('a wrong input changes nothing and answers one line', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files['/work/notes.md'] = '# Notes\n\nNothing to tick here.\n'
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })

  const answers = [
    [{ plan: 'missing.md' }, 'tune: missing.md could not be read. Nothing was changed.'],
    [{ plan: 'notes.md' }, 'tune: notes.md has no task with a checkbox. Nothing was changed.'],
    [{ tracker: { title: 'x' } }, 'tune: tracker needs an id. Nothing was changed.'],
  ] as const
  for (const [input, said] of answers) {
    const answer = await tune($, input)
    expect(answer).toBe(said)
    expect(answer).not.toContain('\n')
    expect(await tune($)).toBe(START_COUNTS)
  }
})

test('a tracker item is noted', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })

  const answer = await tune($, { tracker: { id: 'PROJ-12', title: 'Export to CSV', state: 'In Progress' } })
  expect(answer.startsWith('Tracker item PROJ-12 noted. Tracking docs/plans/export.md:')).toBe(true)
})

test('the tracked plan disappears', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })

  world.failRead.add(PLAN_PATH)
  const sent = await $.prompt.submit({ text: 'go on' } as any)
  expect(sent.text).toBe('go on')
  expect(await tune($)).toBe(`${START_COUNTS} The plan file could not be read; these are the last counts.`)
})

test('a session that tracks nothing asks nothing of the clock or the disk', async ($, on) => {
  let asked = 0
  on('clock.now', () => {
    asked += 1

    return { value: 0 }
  })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files['/work/src/a.ts'] = 'const a = 1\n'
  fake(on, world)
  await $.session.start(START)
  const sent = await $.prompt.submit({ text: 'go' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'a = 1', new_string: 'a = 2' } as any)

  expect(sent.text).toBe('go')
  expect(asked).toBe(0)
  expect(world.reads.filter(path => !path.startsWith(`${ROOT}/`))).toEqual([])
})

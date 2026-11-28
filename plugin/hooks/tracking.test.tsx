// The tool that names the tracked plan, and the re-reads of the plan after an edit and a prompt.
import { expect, mock, test } from 'claude-code/testing'

import { fake, makeIo, PANE, PLAN_PATH, PLAN_TEXT, ROOT, START, words } from './kit'

const tune = async ($: any, input: Record<string, unknown> = {}): Promise<string> =>
  String((await $.tool.call({ tool: 'mcp__tune__progress', ...input } as any)).result)
const tick = ($: any, step: string) =>
  $.tool.call({ tool: 'Edit', file_path: PLAN_PATH, old_string: `- [ ] ${step}`, new_string: `- [x] ${step}` } as any)

const status = async ($: any): Promise<any> => $.command.run({ command: 'tune', args: 'status' } as any)

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

test('a wrong path with a line break still answers one line', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  const answer = await tune($, { plan: 'missing\nfile.md' })
  expect(answer).not.toContain('\n')
  expect(answer).toContain('missing file.md')
})

test('/tune status prints the tracked plan', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md' })
  await tick($, 'Open the file')

  const answer = await status($)
  expect(answer.text).toMatch(/^plan: docs\/plans\/export\.md$/m)
  expect(answer.text).toMatch(/All tasks.*0 of 3 done · 1 of 9 steps/)
  expect(answer.text).toMatch(/^▶ 1 Read the file\s.*1\/3/m)
  expect(answer.isTextDisplayOnly).toBe(true)
})

test('with nothing tracked it says so', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)

  expect((await status($)).text).toBe('No plan is tracked.')
})

test('the tracker item is shown with how long ago it was given', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await tune($, { plan: 'docs/plans/export.md', tracker: { id: 'PROJ-12', title: 'Export to CSV', state: 'In Progress' } })

  await clock.advance(12 * 60000)
  expect(String((await status($)).text).split('\n')[0]).toBe('PROJ-12 · In Progress · Export to CSV · read 12m ago')
})

test("status in the panel's command field", async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'command', text: 'status' })

  expect(await words(ui)).toMatch(/No plan is tracked\./)
  await ui.unmount()
})

const OUTSIDE = '/elsewhere/plan.md'
const refusal = (plan: string): string =>
  `tune: ${plan} is not a .md file inside this project. To track it, ask the person to type /tune track <path>. Nothing was changed.`
const track = async ($: any, args: string, origin: Record<string, unknown> = { kind: 'composer' }): Promise<any> =>
  $.command.run({ command: 'tune', args, origin } as any)

test("the tool refuses a plan outside the session's folder, and does not read it", async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files[OUTSIDE] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  const answer = await tune($, { plan: OUTSIDE })
  expect(answer).toBe(refusal(OUTSIDE))
  expect(answer).toContain('/tune track')
  expect(answer).toContain('Nothing was changed.')
  expect(answer).not.toContain('\n')
  expect(await tune($)).toBe('No plan is tracked.')
  expect(world.reads).not.toContain(OUTSIDE)
})

test('the refusal is the same whether or not the outside file exists', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files[OUTSIDE] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  const there = await tune($, { plan: OUTSIDE })
  const missing = await tune($, { plan: '/elsewhere/missing.md' })
  expect(missing).toBe(there.replace(OUTSIDE, '/elsewhere/missing.md'))
})

test('a path that climbs out of the folder is outside', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files[OUTSIDE] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  expect(await tune($, { plan: 'docs/../../elsewhere/plan.md' })).toBe(refusal('docs/../../elsewhere/plan.md'))
  expect(world.reads).not.toContain(OUTSIDE)
})

test('a link inside the folder that leads outside is refused', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  world.files[OUTSIDE] = PLAN_TEXT
  world.files['/work/docs/plans/link.md'] = PLAN_TEXT
  world.links['/work/docs/plans/link.md'] = OUTSIDE
  fake(on, world)
  await $.session.start(START)

  expect(await tune($, { plan: 'docs/plans/link.md' })).toBe(refusal('docs/plans/link.md'))
  expect(await tune($)).toBe('No plan is tracked.')
  expect(world.reads).not.toContain('/work/docs/plans/link.md')
})

test('a file that is not .md is refused', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files['/work/notes.txt'] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  expect(await tune($, { plan: 'notes.txt' })).toBe(refusal('notes.txt'))
  expect(await tune($)).toBe('No plan is tracked.')
  expect(world.reads).not.toContain('/work/notes.txt')
})

test('/tune track typed by the person tracks a plan anywhere', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[OUTSIDE] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  const counts = 'Tracking /elsewhere/plan.md: 0 of 3 tasks done, 0 of 9 steps.'
  expect((await track($, `track ${OUTSIDE}`)).text).toBe(counts)
  expect(await tune($)).toBe(counts)
  await $.tool.call({ tool: 'Edit', file_path: OUTSIDE, old_string: '- [ ] Open the file', new_string: '- [x] Open the file' } as any)
  expect(await tune($)).toContain('1 of 9 steps')
})

test('/tune track from a plugin does not reach outside', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[OUTSIDE] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)

  expect((await track($, `track ${OUTSIDE}`, { kind: 'plugin', name: 'other' })).text).toBe(refusal(OUTSIDE))
  expect(await tune($)).toBe('No plan is tracked.')
  expect(world.reads).not.toContain(OUTSIDE)
})

test('/tune track off stops tracking, and /tune track alone answers its usage', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[OUTSIDE] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await track($, `track ${OUTSIDE}`)

  expect((await track($, 'track off')).text).toBe('Nothing is tracked now.')
  expect(await tune($)).toBe('No plan is tracked.')
  const usage = String((await track($, 'track')).text)
  expect(usage).toContain('track <path>')
  expect(usage).not.toContain('\n')
})

test("track in the panel's command field", async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[OUTSIDE] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'command', text: `track ${OUTSIDE}` })

  expect(await words(ui)).toContain('Tracking /elsewhere/plan.md')
  await ui.unmount()
})

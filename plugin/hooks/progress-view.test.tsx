// The pane's progress view: how it opens, what it draws, and how it gives way to the settings.
import { expect, mock, test } from 'claude-code/testing'

import { BUILD, copy, fake, makeIo, PANE, PLAN_PATH, PLAN_TEXT, START, words } from './kit'

const tune = ($: any, args: string): Promise<any> => $.command.run({ command: 'tune', args } as any)
const has = async (ui: any, type: string, key: string): Promise<boolean> => (await ui.find({ type, key })) !== undefined

test('/tune progress opens the panel on the progress view', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const answer = await tune($, 'progress')

  expect(world.opened).toEqual(['tune'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await words(ui)).toContain('No plan is tracked.')
  expect(await has(ui, 'Select', 'effort:executor')).toBe(false)
  const text = String(answer.text ?? '')
  expect(text).toContain('progress view')
  expect(text.includes('\n')).toBe(false)
  await ui.unmount()
})

test('/tune opens the settings view, also after progress was shown', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  await tune($, 'progress')
  await tune($, '')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, 'Select', 'effort:executor')).toBe(true)
  await ui.unmount()
})

test('the progress view does not take the keyboard', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  await tune($, 'progress')
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(undefined)
  expect(world.openArgs[world.openArgs.length - 1]!.closeOnEscape).toBe(undefined)
  await tune($, 'close')
  await tune($, '')
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(true)
  expect(world.openArgs[world.openArgs.length - 1]!.closeOnEscape).toBe(true)
})

test("asking for the other view re-opens the pane with that view's focus", async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  await tune($, 'progress')
  await tune($, '')
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, 'Select', 'effort:executor')).toBe(true)
  await ui.unmount()

  await tune($, 'progress')
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(undefined)
  expect(world.closed).toEqual(['tune', 'tune'])
})

test('a button switches between the views', async ($, on) => {
  const world = makeIo({ profiles: { fast: { ...copy(BUILD), name: 'fast' } }, inForce: 'fast' })
  fake(on, world)
  await $.session.start(START)
  await tune($, '')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, 'Select', 'effort:executor')).toBe(true)
  await ui.press({ key: 'delete' })
  expect(await words(ui)).toContain('Press delete again')

  await ui.press({ key: 'view:progress' })
  expect(await words(ui)).toContain('No plan is tracked.')
  expect(await has(ui, 'Select', 'effort:executor')).toBe(false)
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(undefined)

  await ui.press({ key: 'view:settings' })
  expect(await has(ui, 'Select', 'effort:executor')).toBe(true)
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(true)
  expect((await words(ui)).includes('Press delete again')).toBe(false)
  await ui.unmount()
})

test('progress and close work in the command field', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  await tune($, '')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'command', text: 'progress' })
  expect(await words(ui)).toContain('No plan is tracked.')
  expect(await has(ui, 'Select', 'effort:executor')).toBe(false)
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(undefined)
  await ui.unmount()

  await tune($, '')
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const closed = world.closed.length
  await again.input({ key: 'command', text: 'close' })
  expect(world.closed.length).toBe(closed + 1)
  expect(world.closed[world.closed.length - 1]).toBe('tune')
  await again.unmount()
})

test('shown above the prompt, the progress view says how to have it at the side', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  const answer = await $.command.run({ command: 'tune', args: 'progress', presentation: { isFullscreen: false, columns: 120 } } as any)
  expect(String(answer.text)).toContain('above the prompt')
  expect(String(answer.text)).toContain('For a panel at the side, widen the window or type /tui fullscreen.')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline' }, surface: 'terminal' } as any)
  expect(await words(ui)).toContain('For a panel at the side, widen the window or type /tui fullscreen.')
  await ui.unmount()
})

test('the progress view shows the plan, its tasks and the tracker item', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await $.tool.call({
    tool: 'mcp__tune__progress',
    plan: 'docs/plans/export.md',
    tracker: { id: 'PROJ-12', title: 'Export to CSV', state: 'In Progress' },
  } as any)
  await $.agent.spawn({
    prompt: 'Do Task 2 of the plan at /work/docs/plans/export.md',
    subagentType: 'tune:executor',
    description: 'work',
  } as any)
  await $.tool.call({
    tool: 'Edit',
    file_path: PLAN_PATH,
    old_string: '- [ ] Format one row',
    new_string: '- [x] Format one row',
    agentId: 'a1',
  } as any)
  await tune($, 'progress')

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  const text = await words(ui)
  expect(text).toMatch(/^PROJ-12 · In Progress · Export to CSV · read just now$/m)
  expect(text).toMatch(/^plan: docs\/plans\/export\.md$/m)
  expect(text).toMatch(/All tasks.*0 of 3 done · 1 of 9 steps/)
  expect(text).toMatch(/^▶ 2 Write the rows\s.*1\/4/m)
  await ui.unmount()
})

test('the progress view draws on every surface', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  await tune($, 'progress')
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await words(ui)).toContain('No plan is tracked.')
    expect(await has(ui, 'Button', 'view:settings')).toBe(true)
    await ui.unmount()
  }
})

test('no button in either view has a one-key shortcut', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  for (const which of ['', 'progress']) {
    await tune($, which)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const buttons: any[] = await ui.findAll({ type: 'Button' })
    expect(buttons.length >= 2).toBe(true)
    expect(buttons.filter(button => button.props.hotkey !== undefined).map(button => button.key)).toEqual([])
    await ui.unmount()
  }
})

test('the widget form is one line', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  await tune($, 'progress')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' } as any)

  expect((await ui.findAll({ type: 'Text' })).length).toBe(1)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

test('on a narrow pane no line is cut', async ($, on) => {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await $.tool.call({
    tool: 'mcp__tune__progress',
    plan: 'docs/plans/export.md',
    tracker: { id: 'PROJ-12', title: 'Export to CSV', state: 'In Progress' },
  } as any)
  await tune($, 'progress')

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 30 }, surface: 'terminal' })
  const texts: any[] = await ui.findAll({ type: 'Text' })
  expect(texts.length > 3).toBe(true)
  for (const one of texts) {
    expect(String(one.text).length <= 30).toBe(true)
  }
  await ui.unmount()
})

const ON_TASK_1 = 'Do Task 1 of the plan at /work/docs/plans/export.md'
const spawn = ($: any): Promise<any> =>
  $.agent.spawn({ prompt: ON_TASK_1, subagentType: 'tune:executor', description: 'work' } as any)
const report = ($: any, agentId: string): Promise<any> =>
  $.agent.report({ agentId, subagentType: 'tune:executor', status: 'completed', text: 'done', provider: { plugin: 'tune', tier: 'user' } } as any)

/** The plan tracked and an executor on Task 1, with the clock at 0. */
async function running($: any, on: any): Promise<{ clock: any; world: any }> {
  const clock = mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__tune__progress', plan: 'docs/plans/export.md' } as any)
  await spawn($)

  return { clock, world }
}

/** Whether the pane's list is still asked for: no rise over five more seconds once a period has passed. */
async function stopped(clock: any, world: any): Promise<boolean> {
  await clock.advance(1000)
  const checks = world.paneChecks
  await clock.advance(5000)

  return world.paneChecks === checks
}

test('the open progress view counts on while an agent runs', async ($, on) => {
  const { clock } = await running($, on)
  await tune($, 'progress')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await words(ui)).toContain('0m00s')

  await clock.advance(3000)
  expect(await words(ui)).toContain('0m03s')
  await ui.unmount()
})

test('it stops when the view is closed', async ($, on) => {
  const { clock, world } = await running($, on)
  await tune($, 'progress')
  await tune($, 'close')

  expect(await stopped(clock, world)).toBe(true)
})

test('it stops when the agent has reported', async ($, on) => {
  const { clock, world } = await running($, on)
  await tune($, 'progress')
  await report($, 'a1')

  expect(await stopped(clock, world)).toBe(true)
})

test('it does not run for the settings view', async ($, on) => {
  const { clock, world } = await running($, on)
  await tune($, '')

  expect(await stopped(clock, world)).toBe(true)
})

test('it starts again when a second agent starts with the view still open', async ($, on) => {
  const { clock, world } = await running($, on)
  await tune($, 'progress')
  await report($, 'a1')
  expect(await stopped(clock, world)).toBe(true)

  await spawn($)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  const before = await words(ui)
  const checks = world.paneChecks
  await clock.advance(3000)
  expect(world.paneChecks > checks).toBe(true)
  expect(await words(ui)).not.toBe(before)
  await ui.unmount()
})

test('it draws without a profile', async ($, on) => {
  const world = makeIo()
  world.failRead.add('/plugins/tune/profiles/build.json')
  fake(on, world)
  await $.session.start(START)
  await tune($, 'progress')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await words(ui)).toContain('No plan is tracked.')
  await ui.unmount()
})

/** The time the progress view shows for Task 1, in seconds. */
async function task1Time(ui: any): Promise<number> {
  const found = (await words(ui)).match(/^. 1 Read the file\s.*?(\d+)m(\d\d)s/m)
  expect(found !== null).toBe(true)

  return Number(found![1]) * 60 + Number(found![2])
}

test('the view counts again when a reported agent ticks', async ($, on) => {
  const { clock } = await running($, on)
  const tickBox = (box: string) =>
    $.tool.call({ tool: 'Edit', file_path: PLAN_PATH, old_string: `- [ ] ${box}`, new_string: `- [x] ${box}`, agentId: 'a1' } as any)
  await tickBox('Open the file')
  await report($, 'a1')
  await tune($, 'progress')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })

  await clock.advance(5000)
  await tickBox('Parse the rows')
  const after = await task1Time(ui)
  await clock.advance(3000)
  const later = await task1Time(ui)
  // The plan's two-second re-read alone would show two seconds more.
  expect(later - after).toBe(3)
  await ui.unmount()
})

test('a redraw timer that died is started again', async ($, on) => {
  // Outermost, before the clock: a refused period ends the engine's interval, and the module is not told.
  let refuse = false
  on('clock.*', (_: unknown, e: any, next: any) => (refuse && next.event === 'clock.every' ? { deny: 'refused' } : next(e)))
  const { clock } = await running($, on)
  await tune($, 'progress')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  await clock.advance(2000)
  expect(await words(ui)).toContain('0m02s')

  refuse = true
  await clock.advance(2000)
  refuse = false
  await clock.advance(10000)
  await spawn($)
  const before = await words(ui)
  await clock.advance(3000)
  expect(await words(ui)).not.toBe(before)
  await ui.unmount()
})

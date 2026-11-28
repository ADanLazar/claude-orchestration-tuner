// The pane's progress view: how it opens, what it draws, and how it gives way to the settings.
import { expect, mock, test } from 'claude-code/testing'

import { fake, makeIo, PANE, PLAN_PATH, PLAN_TEXT, START, words } from './kit'

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
  await tune($, 'close')
  await tune($, '')
  expect(world.openArgs[world.openArgs.length - 1]!.focus).toBe(true)
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
  fake(on, makeIo())
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, 'Select', 'effort:executor')).toBe(true)

  await ui.press({ key: 'view:progress' })
  expect(await words(ui)).toContain('No plan is tracked.')
  expect(await has(ui, 'Select', 'effort:executor')).toBe(false)

  await ui.press({ key: 'view:settings' })
  expect(await has(ui, 'Select', 'effort:executor')).toBe(true)
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

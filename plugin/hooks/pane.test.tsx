import { expect, test } from 'claude-code/testing'

import { BUILD, copy, fake, latest, mainRanAt, makeIo, ownIn, PANE, START, words } from './kit'

const FAST = { ...copy(BUILD), name: 'fast' }
const has = async (ui: any, type: string, key: string): Promise<boolean> => (await ui.find({ type, key })) !== undefined
const stored = ownIn

test('the panel draws on every surface', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = await words(ui)
    expect(text).toMatch(/Tune · build/)
    expect(text).toMatch(/build: Builds with a team of role agents\./)
    expect(text).toMatch(/running now/)
    expect(await has(ui, 'Select', 'effort:executor')).toBe(true)
    expect(await has(ui, 'Select', 'model:security-reviewer')).toBe(true)
    expect(await has(ui, 'Button', 'use:build')).toBe(true)
    await ui.unmount()
  }
})

test('choosing an effort changes the profile and registers the persona again', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'effort:executor', value: 'high' })
  await ui.select({ key: 'model:writer', value: 'sonnet' })

  expect(stored(world).build.roles.executor.effort).toBe('high')
  expect(latest(world, 'executor')!.effort).toBe('high')
  expect(latest(world, 'writer')!.model).toBe('sonnet')
  await ui.unmount()
})

test('changing the shipped profile marks it changed and offers reset; reset returns the shipped level', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, 'Button', 'reset')).toBe(false)
  expect(await has(ui, 'Button', 'delete')).toBe(false)

  await ui.select({ key: 'effort:executor', value: 'low' })
  expect(await words(ui)).toMatch(/changed from the shipped profile/)
  await ui.press({ key: 'reset' })

  expect(stored(world).build).toBe(undefined)
  expect(latest(world, 'executor')!.effort).toBe('medium')
  expect(await has(ui, 'Button', 'reset')).toBe(false)
  await ui.unmount()
})

test('new makes a copy and puts it in force; a second new makes -3', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'new' })

  expect(world.store.inForce).toBe('build-2')
  expect(stored(world)['build-2'].name).toBe('build-2')
  expect(await words(ui)).toMatch(/Tune · build-2/)

  await ui.press({ key: 'new' })
  expect(world.store.inForce).toBe('build-3')
  expect(Object.keys(stored(world)).sort()).toEqual(['build-2', 'build-3'])
  await ui.unmount()
})

test('pressing a profile puts it in force', async ($, on) => {
  const fast = copy(FAST)
  fast.roles.executor = { model: 'haiku', effort: 'low' }
  const world = makeIo({ profiles: { fast } })
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'use:fast' })

  expect(world.store.inForce).toBe('fast')
  expect(latest(world, 'executor')!.model).toBe('haiku')
  expect(await has(ui, 'Button', 'delete')).toBe(true)
  await ui.unmount()
})

test('delete asks twice', async ($, on) => {
  const world = makeIo({ profiles: { fast: FAST }, inForce: 'fast' })
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'delete' })

  expect(stored(world).fast !== undefined).toBe(true)
  expect(await words(ui)).toMatch(/Delete fast\? Press delete again\./)

  await ui.press({ key: 'delete' })
  expect(stored(world).fast).toBe(undefined)
  expect(world.store.inForce).toBe('build')
  expect(await words(ui)).toMatch(/Tune · build/)
  await ui.unmount()
})

test('another press between clears the question', async ($, on) => {
  const world = makeIo({ profiles: { fast: FAST }, inForce: 'fast' })
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'delete' })
  await ui.select({ key: 'effort:executor', value: 'high' })
  expect((await words(ui)).includes('Press delete again')).toBe(false)

  await ui.press({ key: 'delete' })
  expect(stored(world).fast !== undefined).toBe(true)
  await ui.unmount()
})

test('a rule select changes the brief', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'review', value: 'each-task' })
  await ui.select({ key: 'order', value: 'time,correct,tokens' })
  await ui.select({ key: 'escalation', value: 'off' })
  await ui.unmount()

  expect(stored(world).build.review).toBe('each-task')
  expect(stored(world).build.order).toEqual(['time', 'correct', 'tokens'])
  expect(stored(world).build.escalation).toBe(false)
  // The conversation is given the changed rules beside its next prompt.
  const sent = await $.prompt.submit({ text: 'go' } as any)
  expect(sent.context?.[0]).toContain('Review after each task.')
})

test('a full model id is shown as its own option', async ($, on) => {
  const changed = copy(BUILD)
  changed.roles.planner = { model: 'claude-opus-5-5', effort: 'high' }
  fake(on, makeIo({ profiles: { build: changed } }))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const select: any = await ui.find({ type: 'Select', key: 'model:planner' })

  expect(select.props.value).toBe('claude-opus-5-5')
  expect(select.props.options.map((option: any) => option.value)).toEqual(['haiku', 'sonnet', 'opus', 'fable', 'claude-opus-5-5'])
  await ui.unmount()
})

test('a filled profile shows new on the filled row and keep saves it', async ($, on) => {
  const older: any = copy(FAST)
  delete older.roles.designer
  const world = makeIo({ profiles: { fast: older }, inForce: 'fast' })
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await words(ui)).toMatch(/designer\s+new/)
  await ui.press({ key: 'keep' })
  expect(stored(world).fast.roles.designer).toEqual({ model: 'sonnet', effort: 'medium' })
  expect(await has(ui, 'Button', 'keep')).toBe(false)
  await ui.unmount()
})

test('a broken profile can be deleted from the panel', async ($, on) => {
  const world = makeIo({ profiles: { odd: null } })
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await words(ui)).toMatch(/odd cannot be read/)
  expect(await has(ui, 'Button', 'use:odd')).toBe(false)
  await ui.press({ key: 'delete-broken:odd' })
  expect('odd' in stored(world)).toBe(false)
  await ui.unmount()
})

test('the command field runs a command and shows its answer', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'command', text: 'set notes Ask before adding a dependency.' })

  expect(stored(world).build.notes).toBe('Ask before adding a dependency.')
  expect(await words(ui)).toMatch(/build: notes is now Ask before adding a dependency\./)

  await ui.input({ key: 'command', text: 'use nothing' })
  expect(await words(ui)).toMatch(/tune: no profile named 'nothing'/)
  expect(world.store.inForce).toBe(undefined)
  await ui.unmount()
})

test('why shows a reason for each row', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await words(ui)).includes('Speed and intelligence.')).toBe(false)

  await ui.press({ key: 'why' })
  const text = await words(ui)
  expect(text).toMatch(/executor: sonnet \/ medium, 1x the price of Sonnet/)
  expect(text).toMatch(/Speed and intelligence\. The starting point for agentic coding\./)
  expect(text).toMatch(/you: fable \/ high, 4x the price of Sonnet/)

  await ui.press({ key: 'why' })
  expect((await words(ui)).includes('Speed and intelligence.')).toBe(false)
  await ui.unmount()
})

test('the panel says when the main conversation runs at another effort, and what is running', async ($, on) => {
  const world = makeIo()
  world.agents = [
    { id: 'a1', type: 'tune:executor', taskStatus: 'running', model: 'claude-sonnet-5-5', effort: 'medium', tokenCount: 42000 },
    { id: 'a2', type: 'tune:writer', taskStatus: 'completed', model: 'claude-haiku-5-5', effort: 'high', tokenCount: 9000 },
  ]
  fake(on, world)
  await $.session.start(START)
  await mainRanAt($, 'claude-fable-5-2', 'medium')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = await words(ui)

  expect(text).toMatch(/you\s+fable \/ high/)
  expect(text).toMatch(/now: medium - set with \/effort high/)
  expect(text).toMatch(/executor\s+sonnet-5-5 \/ medium\s+42K/)
  expect(text.includes('haiku-5-5 / high')).toBe(false)
  await ui.unmount()
})

test('/tune with no words opens the pane', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const answer = await $.command.run({ command: 'tune', args: '' } as any)

  expect(world.opened).toEqual(['tune'])
  expect(answer.text).toMatch(/^build: Builds with a team of role agents\./)
})

test('the widget form is one line', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' } as any)

  expect((await words(ui)).trim()).toBe('tune: build · exec sonnet/med · review opus/med')
  expect(await has(ui, 'Select', 'effort:executor')).toBe(false)
  await ui.unmount()
})

test('the panel says so when nothing could be loaded', async ($, on) => {
  const world = makeIo()
  world.failRead.add('/plugins/tune/profiles/build.json')
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await words(ui)).toMatch(/the shipped profile could not be read/)
  expect(await has(ui, 'Select', 'effort:executor')).toBe(false)
  await ui.unmount()
})

test('a changed copy of the shipped profile that cannot be read is shown, with reset', async ($, on) => {
  const world = makeIo({ profiles: { build: { ...copy(BUILD), team: 'sometimes' } } })
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await words(ui)).toMatch(/your changed build cannot be read; its shipped values are in force/)
  await ui.press({ key: 'reset' })
  expect('build' in ownIn(world)).toBe(false)
  expect((await words(ui)).includes('cannot be read')).toBe(false)
  await ui.unmount()
})

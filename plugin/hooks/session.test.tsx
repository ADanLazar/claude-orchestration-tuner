// The hooks that sit on a session: start, each prompt, the system prompt, /tune, each model request.
import { expect, test } from 'claude-code/testing'

import { GUARD, render } from './brief'
import { BUILD, copy, fake, latest, makeIo, START } from './kit'

const COMPOSE = { model: 'claude-fable-5-2', promptModel: 'claude-fable-5-2', surfaces: [], tools: [], outputStyle: null, traits: [] }

test('a session starts with the personas registered and no toast', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)

  expect(world.registered.length).toBe(8)
  expect(latest(world, 'writer')!.model).toBe('haiku')
  expect(latest(world, 'writer')!.effort).toBe('high')
  expect(world.toasts).toEqual([])
  expect(world.writes).toBe(0)
})

test('the brief is added to the system prompt behind the guard', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const { sections } = await $.prompt.compose(COMPOSE as any)
  const last = sections[sections.length - 1]!

  expect(sections[0]!.id).toBe('intro')
  expect(last.id).toBe('tune:brief')
  expect(last.scope).toBe('session')
  expect(last.text).toBe(`${GUARD}\n\n${render(BUILD)}`)
})

test('no brief, no section', async ($, on) => {
  const world = makeIo()
  world.failRead.add('/plugins/tune/profiles/build.json')
  fake(on, world)
  await $.session.start(START)
  const { sections } = await $.prompt.compose(COMPOSE as any)

  expect(sections.map((section: any) => section.id)).toEqual(['intro'])
  expect(world.registered).toEqual([])
})

test('a persona that cannot be registered is said once in a toast', async ($, on) => {
  const world = makeIo()
  world.failRegister.add('designer')
  fake(on, world)
  await $.session.start(START)

  expect(world.toasts.length).toBe(1)
  expect(world.toasts[0]).toMatch(/^tune: designer: could not be registered/)
})

test('a change made elsewhere is applied at the next prompt and handed to the conversation', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)

  const changed = copy(BUILD)
  changed.roles.executor = { model: 'opus', effort: 'high' }
  changed.review = 'each-task'
  world.store.profiles = { build: changed }
  world.store.stamp = 1
  const sent = await $.prompt.submit({ text: 'next' } as any)

  expect(latest(world, 'executor')!.model).toBe('opus')
  expect(sent.text).toBe('next')
  expect(sent.context?.length).toBe(1)
  expect(sent.context?.[0]).toMatch(/^Tune: the profile in force changed\. These rules replace the earlier Tune rules/)
  expect(sent.context?.[0]).toContain('Review after each task.')

  const again = await $.prompt.submit({ text: 'and again' } as any)
  expect(again.context ?? []).toEqual([])
})

test('a prompt with nothing changed re-registers nothing and carries nothing', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const sent = await $.prompt.submit({ text: 'hello' } as any)

  expect(world.registered.length).toBe(8)
  expect(sent.context ?? []).toEqual([])
})

test('the profile in force deleted elsewhere falls back to build at the next prompt', async ($, on) => {
  const fast = { ...copy(BUILD), name: 'fast' }
  fast.roles.executor = { model: 'haiku', effort: 'low' }
  const world = makeIo({ profiles: { fast }, inForce: 'fast', stamp: 3 })
  fake(on, world)
  await $.session.start(START)
  expect(latest(world, 'executor')!.model).toBe('haiku')

  world.store.profiles = {}
  world.store.stamp = 4
  const sent = await $.prompt.submit({ text: 'go' } as any)

  expect(sent.text).toBe('go')
  expect(latest(world, 'executor')!.model).toBe('sonnet')
  expect(sent.context?.[0]).toContain('Tune profile: build.')
})

test('a failing store never stops a prompt or the system prompt', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  world.failStore = true
  const sent = await $.prompt.submit({ text: 'still here' } as any)
  const { sections } = await $.prompt.compose(COMPOSE as any)

  expect(sent.text).toBe('still here')
  expect(sections[sections.length - 1]!.id).toBe('tune:brief')
})

test('a slash command is passed on untouched', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  world.store.stamp = 9
  const sent = await $.prompt.submit({ text: '/help', command: { name: 'help' } } as any)

  expect(sent.context ?? []).toEqual([])
  expect(world.registered.length).toBe(8)
})

test('/tune with words answers, applies the change and hands over changed rules', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)

  const level = await $.command.run({ command: 'tune', args: 'set executor effort high' } as any)
  expect(level.text).toMatch(/^build: executor effort is now high\./)
  expect(latest(world, 'executor')!.effort).toBe('high')
  // Levels are not in the rules, so the conversation has nothing new to read.
  expect(level.context ?? []).toEqual([])

  const rule = await $.command.run({ command: 'tune', args: 'set review each-task' } as any)
  expect(rule.context?.[0]).toContain('Review after each task.')
  const sent = await $.prompt.submit({ text: 'go' } as any)
  expect(sent.context ?? []).toEqual([])
})

test('/tune with a refused command changes nothing', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  const answer = await $.command.run({ command: 'tune', args: 'use nothing' } as any)

  expect(answer.text).toBe("tune: no profile named 'nothing'")
  expect(world.registered.length).toBe(8)
})

test('turn.step passes the request through', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  let sent = 0
  async function* model(_: unknown, e: any) {
    sent += 1
    yield { kind: 'text', index: 0, text: `ran at ${e.effort}` }

    return { turnId: e.turnId, index: e.index, answer: `ran at ${e.effort}`, toolUses: [], stopReason: 'end_turn' }
  }
  on('turn.step', model as any)
  await $.session.start(START)

  const pieces: any[] = []
  for await (const piece of $.turn.step({
    turnId: 'turn-1',
    index: 0,
    model: 'claude-fable-5-2',
    effort: 'max',
    messageCount: 1,
  } as any) as any) {
    pieces.push(piece)
  }

  expect(sent).toBe(1)
  expect(pieces.some(piece => piece.text === 'ran at max')).toBe(true)
})

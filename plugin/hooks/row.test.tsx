import { expect, test } from 'claude-code/testing'

import { fake, mainRanAt, makeIo, ROW, START, words } from './kit'

const SURFACES = ['terminal', 'desktop'] as const

test('the row names the profile and two levels', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...ROW, surface })
    expect((await words(ui)).trim()).toBe('tune: build · exec sonnet/med · review opus/med')
    expect((await ui.find({ type: 'Button', key: 'panel' })) !== undefined).toBe(true)
    await ui.unmount()
  }
})

test('the row marks a main conversation at another effort', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  await mainRanAt($, 'claude-fable-5-2', 'medium')
  const ui = await $.ui.mount({ ...ROW, surface: 'terminal' })

  expect((await words(ui)).trim()).toBe('tune: build · exec sonnet/med · review opus/med · you medium!')
  await ui.unmount()
})

test('a main conversation at the asked effort is not marked', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  await mainRanAt($, 'claude-fable-5-2', 'high')
  const ui = await $.ui.mount({ ...ROW, surface: 'terminal' })

  expect((await words(ui)).includes('you')).toBe(false)
  await ui.unmount()
})

test('the row shortens in steps and never wraps', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  const at = async (bodyColumns: number): Promise<string> => {
    const ui = await $.ui.mount({ ...ROW, props: { ...ROW.props, bodyColumns }, surface: 'terminal' })
    const text = (await words(ui)).trim()
    await ui.unmount()

    return text
  }

  expect(await at(40)).toBe('tune: build · exec sonnet/med')
  expect(await at(14)).toBe('tune: build')
  expect((await at(8)).length <= 8).toBe(true)
  expect((await at(8)).startsWith('tune')).toBe(true)
})

test('no profile could be loaded', async ($, on) => {
  const world = makeIo()
  world.failRead.add('/plugins/tune/profiles/build.json')
  fake(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...ROW, surface: 'terminal' })

  expect((await words(ui)).trim()).toBe('tune: not loaded')
  await ui.unmount()
})

test('pressing panel opens the panel, and pressing it again closes it', async ($, on) => {
  const world = makeIo()
  fake(on, world)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...ROW, surface })
    await ui.press({ key: 'panel' })
    expect(world.opened.length).toBe(world.closed.length + 1)
    await ui.press({ key: 'panel' })
    expect(world.closed.length).toBe(world.opened.length)
    await ui.unmount()
  }

  expect(world.opened).toEqual(['tune', 'tune'])
  expect(world.closed).toEqual(['tune', 'tune'])
  expect(world.openArgs[0]!.closeOnEscape).toBe(true)
})

test('a survey showing above the prompt is left alone', async ($, on) => {
  fake(on, makeIo())
  await $.session.start(START)
  const ui = await $.ui.mount({ ...ROW, props: { ...ROW.props, hasSurvey: true }, surface: 'terminal' })

  expect((await words(ui)).includes('tune:')).toBe(false)
  await ui.unmount()
})

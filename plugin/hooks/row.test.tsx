import { expect, mock, test } from 'claude-code/testing'

import type { View } from '../types'
import { BUILD, fake, mainRanAt, makeIo, PANE, PLAN_PATH, PLAN_TEXT, ROW, START, words } from './kit'
import { rowText } from './register'

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

/** A session with the clock at 0 and the fixture plan in its files; `track` tracks it. */
async function withPlan($: any, on: any, track: boolean): Promise<any> {
  mock.clock(on, { now: 0 })
  const world = makeIo()
  world.files[PLAN_PATH] = PLAN_TEXT
  fake(on, world)
  await $.session.start(START)
  if (track) {
    await $.tool.call({ tool: 'mcp__tune__progress', plan: 'docs/plans/export.md' } as any)
  }

  return world
}

const hasProgress = async ($: any): Promise<boolean> => {
  const ui = await $.ui.mount({ ...ROW, surface: 'terminal' })
  const found = (await ui.find({ type: 'Button', key: 'progress' })) !== undefined
  await ui.unmount()

  return found
}

test('the row shows the count of tasks done when a plan is tracked', async ($, on) => {
  await withPlan($, on, true)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...ROW, surface })
    expect((await words(ui)).trim()).toBe('tune: build · 0/3 tasks · exec sonnet/med · review opus/med')
    await ui.unmount()
  }
})

test('on a narrow row the levels go before the count', () => {
  const world = { shipped: { build: BUILD }, own: {}, filled: {}, broken: {}, inForce: 'build', stamp: '', storeError: null, note: null }
  const view: View = { world, brief: '', applied: '', problems: [] }

  expect(rowText(view, null, 41, '0/3 tasks')).toBe('tune: build · 0/3 tasks · exec sonnet/med')
  expect(rowText(view, null, 30, '0/3 tasks')).toBe('tune: build · 0/3 tasks')
  expect(rowText(view, null, 15, '0/3 tasks')).toBe('tune: build')
})

test('the progress button shows only when a plan is tracked or an agent runs', async ($, on) => {
  await withPlan($, on, false)
  expect(await hasProgress($)).toBe(false)

  await $.tool.call({ tool: 'mcp__tune__progress', plan: 'docs/plans/export.md' } as any)
  expect(await hasProgress($)).toBe(true)

  await $.tool.call({ tool: 'mcp__tune__progress', clear: true } as any)
  await $.agent.spawn({ prompt: 'Look around', subagentType: 'tune:executor', description: 'work' } as any)
  expect(await hasProgress($)).toBe(true)
})

test('pressing progress opens the progress view, and pressing it again closes it', async ($, on) => {
  const world = await withPlan($, on, true)
  const ui = await $.ui.mount({ ...ROW, surface: 'terminal' })
  await ui.press({ key: 'progress' })
  expect(world.opened).toEqual(['tune'])
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await words(pane)).toMatch(/^plan: docs\/plans\/export\.md$/m)
  await pane.unmount()

  await ui.press({ key: 'progress' })
  expect(world.closed).toEqual(['tune'])
  await ui.unmount()
})

test('with the settings showing, pressing progress switches the view', async ($, on) => {
  const world = await withPlan($, on, true)
  await $.command.run({ command: 'tune', args: '' } as any)
  const ui = await $.ui.mount({ ...ROW, surface: 'terminal' })
  await ui.press({ key: 'progress' })
  await ui.unmount()

  // The pane is open: re-opened on the progress view, so that the view leaves the keyboard with the prompt.
  expect(world.opened.length).toBe(world.closed.length + 1)
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await words(pane)).toMatch(/^plan: docs\/plans\/export\.md$/m)
  expect((await pane.find({ type: 'Select', key: 'effort:executor' })) !== undefined).toBe(false)
  await pane.unmount()
})

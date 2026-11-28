import { expect, test } from 'claude-code/testing'

import { render } from './brief'
import { HELP, run } from './commands'
import { BUILD, copy, makeIo } from './kit'
import { get, kind, load, names } from './store'

const FAST = { ...copy(BUILD), name: 'fast' }
const words = (line: string): string[] => line.split(' ')

test('list marks the profile in force', async () => {
  const fake = makeIo({ profiles: { fast: FAST, odd: null } })
  const { text, changed } = await run(fake.io, ['list'])

  expect(changed).toBe(false)
  expect(text).toMatch(/^\* build/m)
  expect(text).toMatch(/^  fast/m)
  expect(text).toMatch(/^  odd .*cannot be read/m)
})

test('show prints every dial', async () => {
  const { text } = await run(makeIo().io, ['show'])

  expect(text).toMatch(/^build: Builds with a team of role agents\./)
  expect(text).toMatch(/^you\s+fable \/ high$/m)
  expect(text).toMatch(/^security-reviewer\s+opus \/ medium$/m)
  expect(text).toMatch(/^team\s+when-split$/m)
  expect(text).toMatch(/^escalation\s+on$/m)
  expect(text).toMatch(/^order\s+correct, time, tokens$/m)
  expect(text).toMatch(/^start_higher\s+sign-in, permissions, payments, data migrations$/m)
  expect(text).toMatch(/^notes\s+\(none\)$/m)
})

test('set executor effort high changes the level of the profile in force', async () => {
  const fake = makeIo()
  const { text, changed } = await run(fake.io, words('set executor effort high'))
  const world = await load(fake.io)

  expect(changed).toBe(true)
  expect(get(world, 'build').roles.executor!.effort).toBe('high')
  expect(kind(world, 'build')).toBe('changed')
  expect(text).toMatch(/^build: executor effort is now high\./)
  expect(text).toContain('reset build')
})

test('set takes a dial by its path, a list, and the rest of the line for text', async () => {
  const fake = makeIo()
  await run(fake.io, words('set main.effort medium'))
  await run(fake.io, words('set order time, correct, tokens'))
  await run(fake.io, words('set notes Ask before adding a dependency, in any project.'))
  const build = get(await load(fake.io), 'build')

  expect(build.main.effort).toBe('medium')
  expect(build.order).toEqual(['time', 'correct', 'tokens'])
  expect(build.notes).toBe('Ask before adding a dependency, in any project.')
})

test('set ... in fast changes another profile', async () => {
  const fake = makeIo({ profiles: { fast: FAST } })
  const { text } = await run(fake.io, words('set executor model opus in fast'))
  const world = await load(fake.io)

  expect(get(world, 'fast').roles.executor!.model).toBe('opus')
  expect(get(world, 'build').roles.executor!.model).toBe('sonnet')
  expect(text).toMatch(/^fast: executor model is now opus\.$/)
})

test('new, use, delete and reset each change the profiles', async () => {
  const fake = makeIo()

  expect((await run(fake.io, words('new fast'))).text).toBe('fast created from build.')
  expect((await run(fake.io, words('new slow from fast'))).changed).toBe(true)
  expect((await run(fake.io, words('use fast'))).text).toBe('fast is in force.')
  expect((await load(fake.io)).inForce).toBe('fast')

  const asked = await run(fake.io, words('delete fast'))
  expect(asked.changed).toBe(false)
  expect(asked.text).toBe('To delete fast, repeat the command as: delete fast yes')
  expect(names(await load(fake.io))).toEqual(['build', 'fast', 'slow'])

  expect((await run(fake.io, words('delete fast yes'))).text).toBe('fast is deleted. build is in force.')
  expect((await run(fake.io, words('delete slow yes'))).text).toBe('slow is deleted.')

  await run(fake.io, words('set writer model sonnet'))
  expect((await run(fake.io, words('reset build'))).text).toBe('build is back to its shipped values.')
  expect(get(await load(fake.io), 'build')).toEqual(BUILD)
})

test('a refused change answers one line and saves nothing', async () => {
  const fake = makeIo()
  const cases: [string, RegExp][] = [
    ['new build', /^tune: there is already a profile named 'build'$/],
    ['new Fast', /^tune: 'Fast': a name is lower-case letters/],
    ['delete build yes', /^tune: build is a shipped profile and cannot be deleted$/],
    ['use nothing', /^tune: no profile named 'nothing'$/],
    ['set executor effort huge', /^tune: roles\.executor\.effort: must be one of/],
    ['set volume 11', /^tune: volume: is not a dial Tune knows$/],
    ['brief nothing', /^tune: no profile named 'nothing'$/],
  ]
  for (const [line, expected] of cases) {
    const { text, changed } = await run(fake.io, words(line))
    expect(changed).toBe(false)
    expect(text).toMatch(expected)
    expect(text.includes('\n')).toBe(false)
  }
  expect(fake.writes).toBe(0)
})

test('a command that is not one, or is misused, answers with the commands that exist', async () => {
  const fake = makeIo()
  for (const line of ['frobnicate', 'new a b', 'set', 'set notes', 'use', 'delete']) {
    const { text, changed } = await run(fake.io, words(line))
    expect(changed).toBe(false)
    expect(text.startsWith('tune: ')).toBe(true)
    expect(text).toContain(HELP)
  }
  expect((await run(fake.io, [])).text).toBe(HELP)
  expect(fake.writes).toBe(0)
})

test('brief prints the rendered brief', async () => {
  expect((await run(makeIo().io, ['brief'])).text).toBe(render(BUILD))
})

test('why prints a line per role with its price multiple', async () => {
  const { text } = await run(makeIo().io, ['why'])

  expect(text).toMatch(/^you\s+fable \/ high\s+4x$/m)
  expect(text).toMatch(/^planner\s+opus \/ high\s+2x$/m)
  expect(text).toMatch(/^executor\s+sonnet \/ medium\s+1x$/m)
  expect(text).toMatch(/^writer\s+haiku \/ high\s+0\.05x$/m)
  expect(text).toContain('Speed and intelligence. The starting point for agentic coding.')
  expect(text).toContain('Effort has no price of its own.')
  expect(text).toContain('https://example.test/effort')
})

test('a store that cannot be read refuses a change in one line', async () => {
  const fake = makeIo()
  fake.failStore = true

  expect((await run(fake.io, words('new fast'))).text).toBe('tune: own profiles could not be read; nothing was changed')
  expect((await run(fake.io, ['list'])).text).toMatch(/^\* build/m)
})

test('"in <word>" names another profile only when there is one of that name', async () => {
  const fake = makeIo({ profiles: { prod: { ...copy(BUILD), name: 'prod' } } })
  await run(fake.io, words('set start_higher sign-in, logs in staging'))
  expect(get(await load(fake.io), 'build').start_higher).toEqual(['sign-in', 'logs in staging'])

  await run(fake.io, words('set executor effort high in prod'))
  const world = await load(fake.io)
  expect(get(world, 'prod').roles.executor!.effort).toBe('high')
  expect(get(world, 'build').roles.executor!.effort).toBe('medium')
})

test('the main conversation takes the short form too, and quotes in a note are kept', async () => {
  const fake = makeIo()
  expect((await run(fake.io, words('set main effort medium'))).text).toMatch(/^build: main effort is now medium\./)
  await run(fake.io, words('set notes Say "hi" first.'))
  const build = get(await load(fake.io), 'build')

  expect(build.main.effort).toBe('medium')
  expect(build.notes).toBe('Say "hi" first.')
})

test('delete of a shipped profile is refused before anyone confirms', async () => {
  const fake = makeIo()

  expect((await run(fake.io, words('delete build'))).text).toBe('tune: build is a shipped profile and cannot be deleted')
  expect((await run(fake.io, words('delete constructor'))).text).toBe("tune: no profile named 'constructor'")
  expect(fake.writes).toBe(0)
})

test('list shows a changed shipped profile that cannot be read', async () => {
  const fake = makeIo({ profiles: { build: { ...copy(BUILD), team: 'sometimes' } } })
  const { text } = await run(fake.io, ['list'])

  expect(text).toMatch(/^\* build  \(changed, cannot be read: team/m)
})

test('show and set know the two new dials', async () => {
  const { text } = await run(makeIo().io, ['show'])
  expect(text).toMatch(/^questions\s+when-unclear$/m)
  expect(text).toMatch(/^reports\s+each-milestone$/m)

  const set = await run(makeIo().io, words('set questions always'))
  expect(set.text.startsWith('build: questions is now always.')).toBe(true)
  expect(HELP).toContain('questions')
  expect(HELP).toContain('reports')
})

test('HELP names status', () => {
  expect(HELP).toContain('status')
})

test('HELP names track', () => {
  expect(HELP).toContain('track <path>')
  expect(HELP).toContain('track off')
})

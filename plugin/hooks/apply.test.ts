import { expect, test } from 'claude-code/testing'

import { apply } from './apply'
import { BUILD, copy, latest, makeIo, ROOT } from './kit'

test('each persona is registered at the profile\'s level', async () => {
  const fake = makeIo()
  const profile = copy(BUILD)
  profile.roles.executor = { model: 'opus', effort: 'xhigh' }

  expect(await apply(fake.io, profile)).toEqual([])
  expect(fake.registered.map(spec => spec.name).sort()).toEqual(Object.keys(BUILD.roles).sort())
  expect(latest(fake, 'executor')).toEqual({
    name: 'executor',
    description: 'Use for executor work.',
    prompt: 'You are the executor.',
    model: 'opus',
    effort: 'xhigh',
  })
  expect(latest(fake, 'code-reviewer')!.disallowedTools).toEqual(['Write', 'Edit'])
  expect(latest(fake, 'code-reviewer')!.model).toBe('opus')
})

test('a persona whose file cannot be read is reported and the rest register', async () => {
  const fake = makeIo()
  fake.failRead.add(`${ROOT}/agents/writer.md`)
  const problems = await apply(fake.io, BUILD)

  expect(problems.length).toBe(1)
  expect(problems[0]).toMatch(/^writer: /)
  expect(fake.registered.length).toBe(7)
})

test('a refused registration is reported', async () => {
  const fake = makeIo()
  fake.failRegister.add('designer')
  const problems = await apply(fake.io, BUILD)

  expect(problems).toEqual(['designer: could not be registered (the schema refuses it)'])
  expect(fake.registered.length).toBe(7)
})

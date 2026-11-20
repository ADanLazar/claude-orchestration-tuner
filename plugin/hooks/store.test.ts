import { expect, test } from 'claude-code/testing'

import { BUILD, copy, makeIo, ownIn } from './kit'
import { change, create, get, keep, kind, load, names, remove, reset, use } from './store'

/** The message a promise rejects with, or '' when it resolves. */
async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work

    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const FAST = { ...copy(BUILD), name: 'fast' }

test('a fresh machine has build in force', async () => {
  const world = await load(makeIo().io)

  expect(world.inForce).toBe('build')
  expect(world.own).toEqual({})
  expect(world.storeError).toBe(null)
  expect(world.note).toBe(null)
  expect(names(world)).toEqual(['build'])
  expect(kind(world, 'build')).toBe('shipped')
  expect(get(world, 'build')).toEqual(BUILD)
})

test('create copies the profile in force under a new name', async () => {
  const fake = makeIo()
  const world = await create(fake.io, 'fast')

  expect(names(world)).toEqual(['build', 'fast'])
  expect(get(world, 'fast')).toEqual(FAST)
  expect(kind(world, 'fast')).toBe('own')
  expect(world.inForce).toBe('build')
  expect(world.stamp).not.toBe('')
  expect(Object.keys(ownIn(fake))).toEqual(['fast'])
})

test('create refuses a name that exists or is malformed, and saves nothing', async () => {
  const fake = makeIo({ profiles: { fast: FAST }, stamp: 's4' })

  expect(await refusal(create(fake.io, 'fast'))).toBe("there is already a profile named 'fast'")
  expect(await refusal(create(fake.io, 'build'))).toBe("there is already a profile named 'build'")
  expect(await refusal(create(fake.io, 'Fast'))).toMatch(/^'Fast': a name is lower-case letters/)
  expect(await refusal(create(fake.io, 'slow', 'nothing'))).toBe("no profile named 'nothing'")
  expect(fake.writes).toBe(0)
  expect((await load(fake.io)).stamp).toBe('s4')
})

test('change saves one dial of an own profile and raises the stamp', async () => {
  const fake = makeIo({ profiles: { fast: FAST }, stamp: 's4' })
  const world = await change(fake.io, 'fast', 'roles.executor.effort', 'low')

  expect(get(world, 'fast').roles.executor!.effort).toBe('low')
  expect(world.stamp).not.toBe('s4')
  expect(world.stamp).not.toBe('')
  expect(world.shipped.build!.roles.executor!.effort).toBe('medium')
})

test('changing a shipped profile makes an own copy', async () => {
  const fake = makeIo()
  const world = await change(fake.io, 'build', 'roles.writer.model', 'sonnet')

  expect(kind(world, 'build')).toBe('changed')
  expect(get(world, 'build').roles.writer!.model).toBe('sonnet')
  expect(world.shipped.build).toEqual(BUILD)
  expect(names(world)).toEqual(['build'])
})

test('reset removes the own copy of a shipped profile', async () => {
  const fake = makeIo()
  await change(fake.io, 'build', 'roles.writer.model', 'sonnet')
  const world = await reset(fake.io, 'build')

  expect(kind(world, 'build')).toBe('shipped')
  expect(get(world, 'build')).toEqual(BUILD)
  expect(await refusal(reset(fake.io, 'build'))).toBe("'build' has not been changed")

  await create(fake.io, 'fast')
  expect(await refusal(reset(fake.io, 'fast'))).toBe("'fast' is not a shipped profile; delete it instead")
})

test('remove deletes an own profile; in force falls back to build', async () => {
  const fake = makeIo({ profiles: { fast: FAST }, inForce: 'fast' })
  const world = await remove(fake.io, 'fast')

  expect(names(world)).toEqual(['build'])
  expect(world.inForce).toBe('build')
  expect(world.note).toBe(null)
})

test('remove refuses a shipped profile, changed or not, and a name nobody has', async () => {
  const fake = makeIo()

  expect(await refusal(remove(fake.io, 'build'))).toBe('build is a shipped profile and cannot be deleted')
  await change(fake.io, 'build', 'roles.writer.model', 'sonnet')
  expect(await refusal(remove(fake.io, 'build'))).toBe(
    'build is a shipped profile and cannot be deleted; reset returns it to its shipped values',
  )
  expect(await refusal(remove(fake.io, 'nothing'))).toBe("no profile named 'nothing'")
})

test('use puts a profile in force', async () => {
  const fake = makeIo({ profiles: { fast: FAST } })
  const world = await use(fake.io, 'fast')

  expect(world.inForce).toBe('fast')
  expect(world.stamp).not.toBe('')
  expect(await refusal(use(fake.io, 'nothing'))).toBe("no profile named 'nothing'")
})

test('a change that makes the brief too long is refused and nothing is saved', async () => {
  const fake = makeIo({ profiles: { fast: FAST } })
  const message = await refusal(change(fake.io, 'fast', 'notes', 'x'.repeat(3000)))

  expect(message).toContain('the limit is 3000')
  expect(fake.writes).toBe(0)
  expect(get(await load(fake.io), 'fast').notes).toBe('')
})

test('a stored choice that is not a name is ignored, and use replaces it', async () => {
  const fake = makeIo({ profiles: { fast: FAST }, inForce: 7 })
  const world = await load(fake.io)

  expect(world.inForce).toBe('build')
  expect(world.storeError).toBe(null)
  expect((await use(fake.io, 'fast')).inForce).toBe('fast')
})

test('a stored profile that is not a profile is broken, not fatal', async () => {
  const fake = makeIo({ profiles: { fast: null, slow: { ...copy(FAST), name: 'slow', team: 'sometimes' } }, inForce: 'fast' })
  const world = await load(fake.io)

  expect(Object.keys(world.broken).sort()).toEqual(['fast', 'slow'])
  expect(world.broken.slow).toContain('team')
  expect(world.own).toEqual({})
  expect(world.inForce).toBe('build')
  expect(world.note).toBe('fast cannot be read; build is in force')
  expect(await refusal(use(fake.io, 'slow'))).toMatch(/^'slow' cannot be read: team/)

  const after = await remove(fake.io, 'fast')
  expect(Object.keys(after.broken)).toEqual(['slow'])
  expect(after.note).toBe(null)
})

test('a store that cannot be reached leaves build in force', async () => {
  const fake = makeIo({ profiles: { fast: FAST }, inForce: 'fast' })
  fake.failStore = true
  const world = await load(fake.io)

  expect(world.storeError).toBe('own profiles could not be read')
  expect(world.inForce).toBe('build')
  expect(get(world, 'build')).toEqual(BUILD)
})

test('an older own profile is filled, and keep saves it whole', async () => {
  const older: any = copy(FAST)
  delete older.roles.designer
  const fake = makeIo({ profiles: { fast: older } })
  const world = await load(fake.io)

  expect(get(world, 'fast').roles.designer).toEqual({ model: 'sonnet', effort: 'medium' })
  expect(world.filled.fast).toEqual(['roles.designer'])

  const kept = await keep(fake.io, 'fast')
  expect(kept.filled.fast ?? []).toEqual([])
  expect(ownIn(fake).fast.roles.designer).toEqual({ model: 'sonnet', effort: 'medium' })
})

test('the profile in force is gone', async () => {
  const world = await load(makeIo({ inForce: 'fast' }).io)

  expect(world.inForce).toBe('build')
  expect(world.note).toBe('fast is gone; build is in force')
})

test('the shipped profile cannot be read', async () => {
  const fake = makeIo()
  fake.failRead.add('/plugins/tune/profiles/build.json')
  const world = await load(fake.io)

  expect(world.shipped).toEqual({})
  expect(world.storeError).toBe('the shipped profile could not be read')
  expect(names(world)).toEqual([])
})

test('a name every object has is not a profile', async () => {
  const fake = makeIo({ profiles: { fast: FAST } })
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    expect(await refusal(use(fake.io, name))).toBe(`no profile named '${name}'`)
    expect(await refusal(reset(fake.io, name))).toBe(`no profile named '${name}'`)
    expect(await refusal(remove(fake.io, name))).toBe(`no profile named '${name}'`)
    expect(await refusal(change(fake.io, name, 'team', 'always'))).toBe(`no profile named '${name}'`)
  }
  expect(fake.writes).toBe(0)

  const stale = await load(makeIo({ inForce: 'constructor' }).io)
  expect(stale.inForce).toBe('build')
  expect(stale.note).toBe('constructor is gone; build is in force')
})

test('two changes made at the same moment both survive, and each has its own stamp', async () => {
  const fake = makeIo()
  const [first, second] = await Promise.all([create(fake.io, 'aa'), create(fake.io, 'bb')])
  const world = await load(fake.io)

  expect(names(world)).toEqual(['build', 'aa', 'bb'])
  expect(first.stamp === second.stamp && first.stamp !== world.stamp).toBe(false)
  expect(world.stamp).not.toBe('')
})

test('every write has a stamp no other write has', async () => {
  const fake = makeIo()
  const seen = new Set<string>()
  for (const name of ['aa', 'bb', 'cc', 'dd']) {
    seen.add((await create(fake.io, name)).stamp)
  }

  expect(seen.size).toBe(4)
})

test('an own profile whose rules no longer fit is broken, not put in force', async () => {
  const long = { ...copy(FAST), notes: 'x'.repeat(3000) }
  const fake = makeIo({ profiles: { fast: long }, inForce: 'fast' })
  const world = await load(fake.io)

  expect(world.broken.fast).toContain('the limit is 3000')
  expect(world.inForce).toBe('build')
  expect(await refusal(use(fake.io, 'fast'))).toMatch(/^'fast' cannot be read: /)
})

test('a changed copy of a shipped profile that cannot be read says so, and reset clears it', async () => {
  const fake = makeIo({ profiles: { build: { ...copy(BUILD), team: 'sometimes' } } })
  const world = await load(fake.io)

  expect(world.broken.build).toContain('team')
  expect(world.note).toBe('your changed build cannot be read; its shipped values are in force')
  expect(get(world, 'build')).toEqual(BUILD)

  const after = await reset(fake.io, 'build')
  expect(after.broken).toEqual({})
  expect(after.note).toBe(null)
})

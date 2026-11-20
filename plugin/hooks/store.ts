// Where profiles come from and every change to them. Shipped profiles are
// read from the plugin's folder; a person's own profiles and their choice of
// profile live in the plugin's store. Nothing else in the mod touches either.
//
// The store's keys: `profile:<name>` for each own profile, `inForce`, `stamp`
// and `format`. One key to a profile, so two sessions that each save a
// different profile at the same moment do not write over each other.
import { render } from './brief'
import { fill, NAME_RE, ProfileError, setDial, validate } from './profile'
import type { Profile } from './profile'

/** The few things this file needs from the engine, so a test can stand in for them. */
export type Io = {
  /** The plugin's folder. */
  root: string
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  keys: () => Promise<string[]>
  drop: (key: string) => Promise<void>
  read: (path: string) => Promise<string>
  register: (spec: Record<string, unknown>) => Promise<unknown>
}

export const SHIPPED = ['build'] as const
export const FALLBACK = 'build'
const FORMAT = 1
const PREFIX = 'profile:'
const UNREADABLE = 'own profiles could not be read'

export type World = {
  /** Read from the plugin's folder. */
  shipped: Record<string, Profile>
  /** From the store, each brought to the shipped profile's shape. */
  own: Record<string, Profile>
  /** Own profile name -> the dials that were taken from the shipped profile. */
  filled: Record<string, string[]>
  /** Own profile name -> why it cannot be used. */
  broken: Record<string, string>
  /** A name that resolves; FALLBACK when the stored one does not. */
  inForce: string
  /** Changes with every write to the store, by any session; '' before the first. */
  stamp: string
  storeError: string | null
  /** Something the person should be told, such as a fallback. */
  note: string | null
}

type Read = { world: World; reachable: boolean; chosen: unknown }

/**
 * Whether an object holds a key of its own. A profile is looked up by a name
 * a person typed, and every object answers to "constructor".
 */
export const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function read(io: Io): Promise<Read> {
  const world: World = {
    shipped: {},
    own: {},
    filled: {},
    broken: {},
    inForce: FALLBACK,
    stamp: '',
    storeError: null,
    note: null,
  }

  for (const name of SHIPPED) {
    try {
      world.shipped[name] = validate(JSON.parse(await io.read(`${io.root}/profiles/${name}.json`)))
    } catch {
      // Without it there is nothing to fall back on; the callers show the error.
    }
  }
  const base = world.shipped[FALLBACK]
  if (base === undefined) {
    world.storeError = 'the shipped profile could not be read'

    return { world, reachable: false, chosen: undefined }
  }

  const stored: [string, unknown][] = []
  let chosen: unknown
  let reachable = true
  try {
    for (const key of await io.keys()) {
      if (key.startsWith(PREFIX)) {
        stored.push([key.slice(PREFIX.length), await io.get(key)])
      }
    }
    chosen = await io.get('inForce')
    const stamp = await io.get('stamp')
    world.stamp = stamp === undefined || stamp === null ? '' : String(stamp)
  } catch {
    world.storeError = UNREADABLE
    reachable = false
    stored.length = 0
    chosen = undefined
  }

  for (const [name, entry] of stored) {
    try {
      if (!NAME_RE.test(name)) {
        throw new ProfileError('its name is not one a profile can have')
      }
      // The key is the name: a copy made by hand may still carry the old one.
      const { profile, filled } = fill(isObject(entry) ? { ...entry, name } : entry, base)
      // Rules that no longer fit would leave a session with none.
      render(profile)
      world.own[name] = profile
      if (filled.length > 0) {
        world.filled[name] = filled
      }
    } catch (error) {
      world.broken[name] = reason(error)
    }
  }

  const notes: string[] = []
  for (const name of Object.keys(world.broken)) {
    if (has(world.shipped, name)) {
      notes.push(`your changed ${name} cannot be read; its shipped values are in force`)
    }
  }
  if (typeof chosen === 'string' && chosen !== FALLBACK) {
    if (has(world.own, chosen) || has(world.shipped, chosen)) {
      world.inForce = chosen
    } else if (has(world.broken, chosen)) {
      notes.push(`${chosen} cannot be read; ${FALLBACK} is in force`)
    } else {
      notes.push(`${chosen} is gone; ${FALLBACK} is in force`)
    }
  }
  world.note = notes.length > 0 ? notes.join('. ') : null

  return { world, reachable, chosen }
}

/** Everything there is to know about profiles on this machine. Never rejects. */
export async function load(io: Io): Promise<World> {
  return (await read(io)).world
}

/** Shipped names first, then own ones in order; each once. */
export function names(world: World): string[] {
  const shipped = Object.keys(world.shipped)
  const own = Object.keys(world.own)
    .filter(name => !shipped.includes(name))
    .sort()

  return [...shipped, ...own]
}

/** Whether a name is taken, by a profile that works or one that does not. */
const exists = (world: World, name: string): boolean =>
  has(world.shipped, name) || has(world.own, name) || has(world.broken, name)

/** A person's own copy wins over the shipped profile of the same name. */
export function get(world: World, name: string): Profile {
  if (has(world.own, name)) {
    return world.own[name] as Profile
  }
  if (has(world.shipped, name)) {
    return world.shipped[name] as Profile
  }
  if (has(world.broken, name)) {
    throw new ProfileError(`'${name}' cannot be read: ${world.broken[name]}`)
  }
  throw new ProfileError(`no profile named '${name}'`)
}

export function kind(world: World, name: string): 'shipped' | 'changed' | 'own' {
  if (has(world.shipped, name)) {
    return has(world.own, name) || has(world.broken, name) ? 'changed' : 'shipped'
  }

  return 'own'
}

/** Reads for a change: refuses when the store could not be read, so nothing in it is written over blind. */
async function open(io: Io): Promise<{ world: World; chosen: unknown }> {
  const { world, reachable, chosen } = await read(io)
  if (!reachable) {
    throw new ProfileError(`${world.storeError ?? UNREADABLE}; nothing was changed`)
  }

  return { world, chosen }
}

/** Marks the store as changed and answers with what it now holds. */
async function stamped(io: Io): Promise<World> {
  await io.set('format', FORMAT)
  // Unique to this write, so a session that last saw another write notices this one.
  // Written last, so a session that sees the new stamp also sees what it stands for.
  await io.set('stamp', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

  return load(io)
}

/** Puts a profile in force for the machine. */
export async function use(io: Io, name: string): Promise<World> {
  const { world } = await open(io)
  get(world, name)
  await io.set('inForce', name)

  return stamped(io)
}

/** Copies a profile (the one in force unless `from` names another) under a new name. */
export async function create(io: Io, name: string, from?: string): Promise<World> {
  const { world } = await open(io)
  if (!NAME_RE.test(name)) {
    throw new ProfileError(
      `'${name}': a name is lower-case letters, digits and hyphens, starting with a letter, at most 32 characters`,
    )
  }
  if (exists(world, name)) {
    throw new ProfileError(`there is already a profile named '${name}'`)
  }
  const profile = validate({ ...get(world, from ?? world.inForce), name })
  render(profile)
  await io.set(PREFIX + name, profile)

  return stamped(io)
}

/** Changes one dial. A shipped profile changed this way becomes the person's own copy. */
export async function change(io: Io, name: string, path: string, value: string): Promise<World> {
  const { world } = await open(io)
  const profile = setDial(get(world, name), path, value)
  // A profile whose rules would not fit is never saved.
  render(profile)
  await io.set(PREFIX + name, profile)

  return stamped(io)
}

/** Saves an own profile as it now reads, filled dials included. */
export async function keep(io: Io, name: string): Promise<World> {
  const { world } = await open(io)
  if (!has(world.own, name)) {
    get(world, name)
    throw new ProfileError(`'${name}' has nothing to keep`)
  }
  await io.set(PREFIX + name, world.own[name])

  return stamped(io)
}

/** Why a profile cannot be deleted, or null when it can. Changes nothing. */
export function cannotRemove(world: World, name: string): string | null {
  if (has(world.shipped, name)) {
    return (
      `${name} is a shipped profile and cannot be deleted` +
      (kind(world, name) === 'changed' ? '; reset returns it to its shipped values' : '')
    )
  }
  if (!has(world.own, name) && !has(world.broken, name)) {
    return `no profile named '${name}'`
  }

  return null
}

/** Deletes an own profile. If it was in force, the shipped one comes into force. */
export async function remove(io: Io, name: string): Promise<World> {
  const { world, chosen } = await open(io)
  const refusal = cannotRemove(world, name)
  if (refusal !== null) {
    throw new ProfileError(refusal)
  }
  await io.drop(PREFIX + name)
  // The stored choice may name it even when a fallback is already in force.
  if (chosen === name) {
    await io.set('inForce', FALLBACK)
  }

  return stamped(io)
}

/** Returns a changed shipped profile to its shipped values. */
export async function reset(io: Io, name: string): Promise<World> {
  const { world } = await open(io)
  if (!has(world.shipped, name)) {
    get(world, name)
    throw new ProfileError(`'${name}' is not a shipped profile; delete it instead`)
  }
  if (kind(world, name) !== 'changed') {
    throw new ProfileError(`'${name}' has not been changed`)
  }
  await io.drop(PREFIX + name)

  return stamped(io)
}

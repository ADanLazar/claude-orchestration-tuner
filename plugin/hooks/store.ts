// Where profiles come from and every change to them. Shipped profiles are
// read from the plugin's folder; a person's own profiles and their choice of
// profile live in the plugin's store. Nothing else in the mod touches either.
import { render } from './brief'
import { fill, NAME_RE, ProfileError, setDial, validate } from './profile'
import type { Profile } from './profile'

/** The few things this file needs from the engine, so a test can stand in for them. */
export type Io = {
  /** The plugin's folder. */
  root: string
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  read: (path: string) => Promise<string>
  register: (spec: Record<string, unknown>) => Promise<unknown>
}

export const SHIPPED = ['build'] as const
export const FALLBACK = 'build'
const FORMAT = 1
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
  /** The store's change counter. */
  stamp: number
  storeError: string | null
  /** Something the person should be told, such as a fallback. */
  note: string | null
}

type Read = { world: World; raw: Record<string, unknown> | null; chosen: unknown }

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
    stamp: 0,
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

    return { world, raw: null, chosen: undefined }
  }

  let raw: Record<string, unknown> | null = null
  let chosen: unknown
  try {
    const stored = await io.get('profiles')
    chosen = await io.get('inForce')
    const stamp = await io.get('stamp')
    world.stamp = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : 0
    if (stored === undefined || stored === null) {
      raw = {}
    } else if (isObject(stored)) {
      raw = stored
    } else {
      world.storeError = UNREADABLE
    }
  } catch {
    world.storeError = UNREADABLE
  }

  for (const [name, entry] of Object.entries(raw ?? {})) {
    try {
      if (!NAME_RE.test(name)) {
        throw new ProfileError('its name is not one a profile can have')
      }
      // The key is the name: a copy made by hand may still carry the old one.
      const { profile, filled } = fill(isObject(entry) ? { ...entry, name } : entry, base)
      world.own[name] = profile
      if (filled.length > 0) {
        world.filled[name] = filled
      }
    } catch (error) {
      world.broken[name] = reason(error)
    }
  }

  if (typeof chosen === 'string' && chosen !== FALLBACK) {
    if (chosen in world.own || chosen in world.shipped) {
      world.inForce = chosen
    } else if (chosen in world.broken) {
      world.note = `${chosen} cannot be read; ${FALLBACK} is in force`
    } else {
      world.note = `${chosen} is gone; ${FALLBACK} is in force`
    }
  }

  return { world, raw, chosen }
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

/** A person's own copy wins over the shipped profile of the same name. */
export function get(world: World, name: string): Profile {
  const found = world.own[name] ?? world.shipped[name]
  if (found !== undefined) {
    return found
  }
  if (name in world.broken) {
    throw new ProfileError(`'${name}' cannot be read: ${world.broken[name]}`)
  }
  throw new ProfileError(`no profile named '${name}'`)
}

export function kind(world: World, name: string): 'shipped' | 'changed' | 'own' {
  if (name in world.shipped) {
    return name in world.own || name in world.broken ? 'changed' : 'shipped'
  }

  return 'own'
}

/** Reads for a change: refuses when what is stored could be lost by writing. */
async function open(io: Io): Promise<{ world: World; raw: Record<string, unknown>; chosen: unknown }> {
  const { world, raw, chosen } = await read(io)
  if (raw === null) {
    throw new ProfileError(`${world.storeError ?? UNREADABLE}; nothing was changed`)
  }

  return { world, raw, chosen }
}

async function write(
  io: Io,
  world: World,
  next: { profiles?: Record<string, unknown>; inForce?: string },
): Promise<World> {
  if (next.profiles !== undefined) {
    await io.set('profiles', next.profiles)
  }
  if (next.inForce !== undefined) {
    await io.set('inForce', next.inForce)
  }
  await io.set('format', FORMAT)
  // Last, so another session that sees the new stamp also sees what it stands for.
  await io.set('stamp', world.stamp + 1)

  return load(io)
}

/** Puts a profile in force for the machine. */
export async function use(io: Io, name: string): Promise<World> {
  const { world } = await open(io)
  get(world, name)

  return write(io, world, { inForce: name })
}

/** Copies a profile (the one in force unless `from` names another) under a new name. */
export async function create(io: Io, name: string, from?: string): Promise<World> {
  const { world, raw } = await open(io)
  if (!NAME_RE.test(name)) {
    throw new ProfileError(
      `'${name}': a name is lower-case letters, digits and hyphens, starting with a letter, at most 32 characters`,
    )
  }
  if (name in world.shipped || name in world.own || name in world.broken) {
    throw new ProfileError(`there is already a profile named '${name}'`)
  }
  const profile = validate({ ...get(world, from ?? world.inForce), name })
  render(profile)

  return write(io, world, { profiles: { ...raw, [name]: profile } })
}

/** Changes one dial. A shipped profile changed this way becomes the person's own copy. */
export async function change(io: Io, name: string, path: string, value: string): Promise<World> {
  const { world, raw } = await open(io)
  const profile = setDial(get(world, name), path, value)
  // A profile whose rules would not fit is never saved.
  render(profile)

  return write(io, world, { profiles: { ...raw, [name]: profile } })
}

/** Saves an own profile as it now reads, filled dials included. */
export async function keep(io: Io, name: string): Promise<World> {
  const { world, raw } = await open(io)
  const profile = world.own[name]
  if (profile === undefined) {
    get(world, name)
    throw new ProfileError(`'${name}' has nothing to keep`)
  }

  return write(io, world, { profiles: { ...raw, [name]: profile } })
}

/** Deletes an own profile. If it was in force, the shipped one comes into force. */
export async function remove(io: Io, name: string): Promise<World> {
  const { world, raw, chosen } = await open(io)
  if (name in world.shipped) {
    const changed = kind(world, name) === 'changed'
    throw new ProfileError(
      `${name} is a shipped profile and cannot be deleted` +
        (changed ? '; reset returns it to its shipped values' : ''),
    )
  }
  if (!(name in raw)) {
    throw new ProfileError(`no profile named '${name}'`)
  }
  const profiles = { ...raw }
  delete profiles[name]

  // The stored choice may name it even when a fallback is already in force.
  return write(io, world, chosen === name ? { profiles, inForce: FALLBACK } : { profiles })
}

/** Returns a changed shipped profile to its shipped values. */
export async function reset(io: Io, name: string): Promise<World> {
  const { world, raw } = await open(io)
  if (!(name in world.shipped)) {
    get(world, name)
    throw new ProfileError(`'${name}' is not a shipped profile; delete it instead`)
  }
  if (!(name in raw)) {
    throw new ProfileError(`'${name}' has not been changed`)
  }
  const profiles = { ...raw }
  delete profiles[name]

  return write(io, world, { profiles })
}

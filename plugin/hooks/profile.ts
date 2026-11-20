// Profiles: the dials, the values each accepts, and one-dial changes.

export type Level = { model: string; effort: string }

export type Profile = {
  name: string
  summary: string
  main: Level
  team: string
  roles: Record<string, Level>
  escalation: boolean
  start_higher: string[]
  agents: string
  review: string
  tests: string
  order: string[]
  notes: string
}

export const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const TEAM: readonly string[] = ['when-split', 'always', 'never']
export const AGENTS: readonly string[] = ['fresh-per-task', 'may-continue']
export const REVIEW: readonly string[] = ['each-task', 'each-milestone']
export const GOALS: readonly string[] = ['correct', 'time', 'tokens']

export const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/
const ROLE_RE = /^[a-z][a-z0-9-]*$/
const MODEL_ID_RE = /^claude-[a-z0-9][a-z0-9.-]*$/

const KEYS = [
  'name',
  'summary',
  'main',
  'team',
  'roles',
  'escalation',
  'start_higher',
  'agents',
  'review',
  'tests',
  'order',
  'notes',
] as const
const TEXT = ['summary', 'tests', 'notes'] as const
const CHOICES: Record<string, readonly string[]> = { team: TEAM, agents: AGENTS, review: REVIEW }
const LISTS = ['start_higher', 'order'] as const

/** A profile is missing, unreadable or holds a value Tune does not accept. */
export class ProfileError extends Error {}

function fail(field: string, reason: string): never {
  throw new ProfileError(`${field}: ${reason}`)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function level(field: string, value: unknown): Level {
  if (!isObject(value) || Object.keys(value).sort().join() !== 'effort,model') {
    fail(field, 'must hold a model and an effort')
  }
  const { model, effort } = value
  if (typeof model !== 'string' || !(MODELS.includes(model) || MODEL_ID_RE.test(model))) {
    fail(`${field}.model`, `must be one of ${MODELS.join(', ')} or a full model id`)
  }
  if (typeof effort !== 'string' || !EFFORTS.includes(effort)) {
    fail(`${field}.effort`, `must be one of ${EFFORTS.join(', ')}`)
  }

  return { model, effort }
}

/** A checked copy of the profile, or ProfileError naming the field. */
export function validate(data: unknown): Profile {
  if (!isObject(data)) {
    throw new ProfileError('a profile must be a JSON object')
  }
  for (const key of Object.keys(data)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      fail(key, 'is not a dial Tune knows')
    }
  }
  for (const key of KEYS) {
    if (!(key in data)) {
      fail(key, 'is missing')
    }
  }

  if (typeof data.name !== 'string' || !NAME_RE.test(data.name)) {
    fail('name', 'must be lower-case letters, digits and hyphens, starting with a letter')
  }
  for (const key of TEXT) {
    if (typeof data[key] !== 'string') {
      fail(key, 'must be text')
    }
  }
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (typeof data[key] !== 'string' || !allowed.includes(data[key])) {
      fail(key, `must be one of ${allowed.join(', ')}`)
    }
  }
  if (typeof data.escalation !== 'boolean') {
    fail('escalation', 'must be true or false')
  }

  const areas = data.start_higher
  if (!Array.isArray(areas) || areas.some(area => typeof area !== 'string' || area.trim() === '')) {
    fail('start_higher', 'must be a list of areas')
  }
  const order = data.order
  if (
    !Array.isArray(order) ||
    !order.every(goal => typeof goal === 'string') ||
    [...order].sort().join() !== [...GOALS].sort().join()
  ) {
    fail('order', `must hold ${GOALS.join(', ')}, each once`)
  }

  const roles = data.roles
  if (!isObject(roles) || Object.keys(roles).length === 0) {
    fail('roles', 'must name at least one role')
  }
  const checkedRoles: Record<string, Level> = {}
  for (const [role, value] of Object.entries(roles)) {
    if (!ROLE_RE.test(role)) {
      fail(`roles.${role}`, 'is not a valid role name')
    }
    checkedRoles[role] = level(`roles.${role}`, value)
  }

  return {
    name: data.name,
    summary: data.summary as string,
    main: level('main', data.main),
    team: data.team as string,
    roles: checkedRoles,
    escalation: data.escalation,
    start_higher: [...(areas as string[])],
    agents: data.agents as string,
    review: data.review as string,
    tests: data.tests as string,
    order: [...(order as string[])],
    notes: data.notes as string,
  }
}

const split = (value: string): string[] =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')

/** The profile with one dial changed, validated. The input is not changed. */
export function setDial(profile: Profile, path: string, value: string): Profile {
  const next = JSON.parse(JSON.stringify(profile)) as Record<string, any>
  const parts = path.split('.')

  if ((TEXT as readonly string[]).includes(path) || path in CHOICES) {
    next[path] = value
  } else if (path === 'escalation') {
    if (value !== 'on' && value !== 'off') {
      fail('escalation', 'use on or off')
    }
    next.escalation = value === 'on'
  } else if ((LISTS as readonly string[]).includes(path)) {
    next[path] = split(value)
  } else if (parts.length === 2 && parts[0] === 'main' && (parts[1] === 'model' || parts[1] === 'effort')) {
    next.main[parts[1]] = value
  } else if (parts.length === 3 && parts[0] === 'roles' && (parts[2] === 'model' || parts[2] === 'effort')) {
    const role = parts[1] as string
    if (!Object.prototype.hasOwnProperty.call(next.roles, role)) {
      fail(path, `the profile has no role named '${role}'`)
    }
    next.roles[role][parts[2]] = value
  } else {
    fail(path, 'is not a dial Tune knows')
  }

  return validate(next)
}

/**
 * A profile written by another version, brought to the shipped profile's
 * shape: a dial or role it lacks takes the shipped value, and one the
 * shipped profile no longer has is dropped. `filled` names what was taken.
 */
export function fill(data: unknown, shipped: Profile): { profile: Profile; filled: string[] } {
  if (!isObject(data)) {
    throw new ProfileError('a profile must be a JSON object')
  }
  const filled: string[] = []
  const next: Record<string, unknown> = {}
  for (const key of KEYS) {
    if (key === 'roles') {
      continue
    }
    if (key in data) {
      next[key] = data[key]
    } else {
      next[key] = shipped[key]
      filled.push(key)
    }
  }

  const stored = isObject(data.roles) ? data.roles : {}
  const roles: Record<string, unknown> = {}
  for (const role of Object.keys(shipped.roles)) {
    if (Object.prototype.hasOwnProperty.call(stored, role)) {
      roles[role] = stored[role]
    } else {
      roles[role] = shipped.roles[role]
      filled.push(`roles.${role}`)
    }
  }
  next.roles = roles

  return { profile: validate(next), filled }
}

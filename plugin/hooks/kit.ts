// Stand-ins and fixtures the tests share. Nothing here ships behaviour.
import type { Profile } from './profile'

/** The shipped profile, as plugin/profiles/build.json holds it. */
export const BUILD: Profile = {
  name: 'build',
  summary: 'Builds with a team of role agents.',
  main: { model: 'fable', effort: 'high' },
  team: 'when-split',
  roles: {
    planner: { model: 'opus', effort: 'high' },
    executor: { model: 'sonnet', effort: 'medium' },
    'code-reviewer': { model: 'opus', effort: 'medium' },
    'test-engineer': { model: 'sonnet', effort: 'medium' },
    writer: { model: 'haiku', effort: 'high' },
    debugger: { model: 'sonnet', effort: 'high' },
    'security-reviewer': { model: 'opus', effort: 'medium' },
    designer: { model: 'sonnet', effort: 'medium' },
  },
  escalation: true,
  start_higher: ['sign-in', 'permissions', 'payments', 'data migrations'],
  agents: 'fresh-per-task',
  review: 'each-milestone',
  tests:
    'Tests: roughly one focused test per stated behaviour, and more only where a failure would lose data, money or access. Run the tests for the changed area after each change and the whole suite once before each milestone. Do not keep scratch checks as test files.',
  order: ['correct', 'time', 'tokens'],
  notes: '',
}

/** A deep copy, so a test can change one without touching the next test's. */
export const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))

/** The message a call throws, or '' when it does not throw. */
export function failure(call: () => unknown): string {
  try {
    call()

    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** An agent file as the plugin ships one. */
export const PERSONA_TEXT = (name: string, model: string, effort: string): string =>
  [
    '---',
    `name: ${name}`,
    `description: Use for ${name} work.`,
    `model: ${model}`,
    `effort: ${effort}`,
    ...(name.endsWith('reviewer') ? ['disallowedTools: Write, Edit'] : []),
    '---',
    '',
    `You are the ${name}.`,
    '',
  ].join('\n')

export const ROOT = '/plugins/tune'

export type FakeIo = {
  io: {
    root: string
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    read: (path: string) => Promise<string>
    register: (spec: Record<string, unknown>) => Promise<unknown>
  }
  /** What the store holds. */
  store: Record<string, unknown>
  /** What the plugin folder holds, by path. */
  files: Record<string, string>
  /** Every agent spec registered, in order. */
  registered: Record<string, unknown>[]
  /** Paths whose read rejects, and agent names whose registration rejects. */
  failRead: Set<string>
  failRegister: Set<string>
  /** When true, every store call rejects. */
  failStore: boolean
  writes: number
  /** Every toast shown, when the engine stand-ins are in place. */
  toasts: string[]
  /** What `$.agent.list()` answers. */
  agents: unknown[]
}

/** The plugin's folder and store, in memory. */
export function makeIo(seed: Record<string, unknown> = {}): FakeIo {
  const fake: FakeIo = {
    store: copy(seed),
    files: {
      [`${ROOT}/profiles/build.json`]: JSON.stringify(BUILD),
      [`${ROOT}/notes.json`]: JSON.stringify(NOTES),
    },
    registered: [],
    failRead: new Set(),
    failRegister: new Set(),
    failStore: false,
    writes: 0,
    toasts: [],
    agents: [],
    io: {
      root: ROOT,
      get: async key => {
        if (fake.failStore) {
          throw new Error('the store is not there')
        }

        return copy(fake.store[key])
      },
      set: async (key, value) => {
        if (fake.failStore) {
          throw new Error('the store is not there')
        }
        fake.writes += 1
        fake.store[key] = copy(value)
      },
      read: async path => {
        const text = fake.files[path]
        if (text === undefined || fake.failRead.has(path)) {
          throw new Error(`ENOENT: ${path}`)
        }

        return text
      },
      register: async spec => {
        if (fake.failRegister.has(String(spec.name))) {
          throw new Error('the schema refuses it')
        }
        fake.registered.push(spec)

        return { agent: `tune:${String(spec.name)}` }
      },
    },
  }
  for (const [name, level] of Object.entries(BUILD.roles)) {
    fake.files[`${ROOT}/agents/${name}.md`] = PERSONA_TEXT(name, level.model, level.effort)
  }

  return fake
}

/** A small notes.json: the multiples and one note per model and level used in tests. */
export const NOTES = {
  base: 'sonnet',
  caveats: ['Effort has no price of its own.'],
  models: {
    fable: { name: 'Fable 5.2', input: 8, output: 40, note: 'For demanding reasoning.', source: 'https://example.test/fable' },
    opus: { name: 'Opus 5.5', input: 4, output: 20, note: 'For long agentic coding.', source: 'https://example.test/opus' },
    sonnet: { name: 'Sonnet 5.5', input: 2, output: 10, note: 'Speed and intelligence.', source: 'https://example.test/sonnet' },
    haiku: { name: 'Haiku 5.5', input: 0.1, output: 0.5, note: 'High volume.', source: 'https://example.test/haiku' },
  },
  effort: {
    general: { low: 'Most efficient.', medium: 'Balanced.', high: 'As many tokens as needed.', xhigh: 'Extended.', max: 'No limit.' },
    sonnet: { source: 'https://example.test/effort', medium: 'The starting point for agentic coding.' },
  },
}

/**
 * Stands for the engine beneath the mod's hooks: answers each call the mod
 * makes on `$` from the same in-memory folder and store `makeIo` built.
 */
export function fake(on: any, world: FakeIo): void {
  const answer = async (work: Promise<unknown>) => {
    try {
      return { value: await work }
    } catch (error) {
      // A refusal is how a stand-in makes the mod's call on `$` reject.
      return { deny: error instanceof Error ? error.message : String(error) }
    }
  }
  // The mod reads under its real folder; the stand-in serves the same relative path.
  const local = (path: string): string => {
    const hit = Object.keys(world.files).find(key => path.endsWith(key.slice(ROOT.length)))

    return hit ?? path
  }

  on('command.register', () => ({ value: { command: 'tune' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: world.agents }))
  on('ui.toast', (_: unknown, e: any) => {
    world.toasts.push(String(e.text ?? e))

    return { value: undefined }
  })
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text, context: e.context }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  on('store.get', (_: unknown, e: any) => answer(world.io.get(e.key)))
  on('store.set', (_: unknown, e: any) => answer(world.io.set(e.key, e.value)))
  on('fs.read', (_: unknown, e: any) => answer(world.io.read(local(String(e.path)))))
  on('agent.register', (_: unknown, e: any) => answer(world.io.register(e)))
}

export const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

/** The newest spec registered for one persona. */
export const latest = (world: FakeIo, name: string): Record<string, any> | undefined =>
  [...world.registered].reverse().find(spec => spec.name === name) as Record<string, any> | undefined

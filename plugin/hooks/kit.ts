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
    investigator: { model: 'sonnet', effort: 'high' },
  },
  escalation: true,
  start_higher: ['sign-in', 'permissions', 'payments', 'data migrations'],
  agents: 'fresh-per-task',
  review: 'each-milestone',
  questions: 'when-unclear',
  reports: 'each-milestone',
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
    ...(name.endsWith('reviewer') || name === 'investigator' ? ['disallowedTools: Write, Edit'] : []),
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
    keys: () => Promise<string[]>
    drop: (key: string) => Promise<void>
    read: (path: string) => Promise<string>
    register: (spec: Record<string, unknown>) => Promise<unknown>
  }
  /** What the store holds, by key: `profile:<name>`, `inForce`, `stamp`, `format`. */
  store: Record<string, unknown>
  /** What the plugin folder holds, by path. */
  files: Record<string, string>
  /** A file that is a symbolic link, by path: where it really lands, for `$.fs.stat`. */
  links: Record<string, string>
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
  /** The id of every pane the mod asked to open, and what it asked for each time. */
  opened: string[]
  openArgs: Record<string, any>[]
  /** The id of every pane the mod asked to close. */
  closed: string[]
  /** How many model requests reached the stand-in model. */
  requests: number
  /** What `$.session.cwd()` answers. */
  cwd: string
  /** Each spec given to `$.tool.register`, in order. */
  tools: Record<string, any>[]
  /** Every path the mod read, in order. */
  reads: string[]
  /** How many agents the stand-in `agent.spawn` started. */
  spawned: number
}

/**
 * The plugin's folder and store, in memory. A seed names own profiles under
 * `profiles` for brevity; they are stored one to a key, as the mod stores them.
 */
export function makeIo(seed: Record<string, unknown> = {}): FakeIo {
  const store: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(copy(seed))) {
    if (key === 'profiles') {
      for (const [name, profile] of Object.entries(value as Record<string, unknown>)) {
        store[`profile:${name}`] = profile
      }
    } else {
      store[key] = value
    }
  }
  const fake: FakeIo = {
    store,
    files: {
      [`${ROOT}/profiles/build.json`]: JSON.stringify(BUILD),
      [`${ROOT}/notes.json`]: JSON.stringify(NOTES),
    },
    links: {},
    registered: [],
    failRead: new Set(),
    failRegister: new Set(),
    failStore: false,
    writes: 0,
    toasts: [],
    agents: [],
    opened: [],
    openArgs: [],
    closed: [],
    requests: 0,
    cwd: '/work',
    tools: [],
    reads: [],
    spawned: 0,
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
      keys: async () => {
        if (fake.failStore) {
          throw new Error('the store is not there')
        }

        return Object.keys(fake.store)
      },
      drop: async key => {
        if (fake.failStore) {
          throw new Error('the store is not there')
        }
        fake.writes += 1
        delete fake.store[key]
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
  // A path that is a key is served as it is, and only keys under ROOT stand for the plugin's folder.
  const local = (path: string): string => {
    if (path in world.files) {
      return path
    }
    const hit = Object.keys(world.files).find(key => key.startsWith(`${ROOT}/`) && path.endsWith(key.slice(ROOT.length)))

    return hit ?? path
  }

  on('command.register', () => ({ value: { command: 'tune' } }))
  // The panes that are up: opened and not closed since.
  const up = new Set<string>()
  on('ui.open', (_: unknown, e: any) => {
    world.opened.push(String(e.id))
    world.openArgs.push(e)
    up.add(String(e.id))

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: any) => {
    world.closed.push(String(e.id))
    up.delete(String(e.id))

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...up].map(id => ({ id, title: 'Tune', isShown: true, isFocused: true, isPlaced: true })),
  }))
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
  on('store.keys', () => answer(world.io.keys()))
  on('store.delete', (_: unknown, e: any) => answer(world.io.drop(e.key)))
  on('fs.read', (_: unknown, e: any) => {
    // Recorded as served: a read of the plugin's real folder is recorded under ROOT.
    const path = local(String(e.path))
    world.reads.push(path)

    return answer(world.io.read(path))
  })
  // A key of world.files is a file, landing where world.links says or on itself; a folder above one is a
  // directory; anything else leads nowhere, and the call rejects as the engine's does for a missing path.
  on('fs.stat', (_: unknown, e: any) => {
    const path = local(String(e.path))
    const real = (where: string) => (e.resolve ? { realPath: where } : {})
    if (path in world.files) {
      const size = world.files[path]?.length ?? 0

      return { value: { kind: 'file', size, mtimeMs: 0, isLink: path in world.links, ...real(world.links[path] ?? path) } }
    }
    const folder = path.replace(/\/+$/, '')
    if (Object.keys(world.files).some(key => key.startsWith(`${folder}/`))) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, ...real(folder) } }
    }

    return { deny: `stat ${path} failed: ENOENT` }
  })
  on('session.cwd', () => ({ value: world.cwd }))
  on('tool.register', (_: unknown, e: any) => {
    world.tools.push(e)

    return { value: { tool: `mcp__tune__${String(e.name)}` } }
  })
  // The tools themselves, at the bottom of the chain: Edit and Write change world.files.
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === 'Edit') {
      const text = world.files[e.file_path]
      const old = String(e.old_string)
      if (text === undefined || text.split(old).length !== 2) {
        return { result: 'no match', text: 'no match', isError: true }
      }
      world.files[e.file_path] = text.replace(old, () => String(e.new_string))

      return { result: 'edited', text: 'edited' }
    }
    if (e.tool === 'Write') {
      world.files[e.file_path] = String(e.content)

      return { result: 'edited', text: 'edited' }
    }

    return { result: 'ok', text: 'ok' }
  })
  // A started agent is listed as the engine lists it; its report leaves the list alone.
  on('agent.spawn', (_: unknown, e: any) => {
    world.spawned += 1
    const id = `a${world.spawned}`
    world.agents.push({
      id,
      type: e.subagentType,
      taskStatus: 'running',
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      cwd: world.cwd,
      startTime: 0,
    })

    return { model: 'claude-sonnet-5-5', agentId: id }
  })
  on('agent.report', (_: unknown, e: any) => ({ text: e.text }))
  on('agent.register', (_: unknown, e: any) => answer(world.io.register(e)))
  // The model: answers every request with the effort it was asked at.
  on('turn.step', async function* (_: unknown, e: any) {
    world.requests += 1
    yield { kind: 'text', index: 0, text: `ran at ${e.effort}` }

    return { turnId: e.turnId, index: e.index, answer: `ran at ${e.effort}`, toolUses: [], stopReason: 'end_turn' }
  } as any)
}

export const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

/** The plan the tracking tests follow, and where it lies under `cwd`. */
export const PLAN_PATH = '/work/docs/plans/export.md'
export const PLAN_TEXT = [
  '# Export to CSV',
  '',
  '### Task 1: Read the file',
  '',
  '- [ ] Open the file',
  '- [ ] Parse the rows',
  '- [ ] Report bad rows',
  '',
  '### Task 2: Write the rows',
  '',
  '- [ ] Format one row',
  '- [ ] Write the header',
  '- [ ] Write every row',
  '- [ ] Close the file',
  '',
  '### Task 3: Tests',
  '',
  '- [ ] Test an empty file',
  '- [ ] Test a large file',
  '',
].join('\n')

/** The newest spec registered for one persona. */
export const latest = (world: FakeIo, name: string): Record<string, any> | undefined =>
  [...world.registered].reverse().find(spec => spec.name === name) as Record<string, any> | undefined

export const ROW = {
  plugin: 'tune',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

export const PANE = {
  plugin: 'tune',
  component: 'Pane',
  requestId: 'tune',
  props: {
    title: 'Tune',
    isFocused: true,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

/** The text of every Text element drawn, joined: enough to assert what a person reads. */
export async function words(ui: any): Promise<string> {
  const found = await ui.findAll({ type: 'Text' })

  return found.map((one: any) => one.text).join('\n')
}

/** One model request by the main conversation at this level; resolves to the pieces streamed back. */
export async function mainRanAt($: any, model: string, effort: string): Promise<any[]> {
  const pieces: any[] = []
  for await (const piece of $.turn.step({ turnId: 'turn-1', index: 0, model, effort, messageCount: 1 } as any) as any) {
    pieces.push(piece)
  }

  return pieces
}

/** The own profiles a store holds, by name. */
export function ownIn(world: FakeIo): Record<string, any> {
  const found: Record<string, any> = {}
  for (const [key, value] of Object.entries(world.store)) {
    if (key.startsWith('profile:')) {
      found[key.slice('profile:'.length)] = value
    }
  }

  return found
}

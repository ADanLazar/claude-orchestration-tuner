// The values Tune keeps in the session's state, and their shapes.
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
  questions: string
  reports: string
  tests: string
  order: string[]
  notes: string
}

export type World = {
  shipped: Record<string, Profile>
  own: Record<string, Profile>
  filled: Record<string, string[]>
  broken: Record<string, string>
  inForce: string
  stamp: string
  storeError: string | null
  note: string | null
}

/** What the session last loaded and applied. */
export type View = {
  /** Null until the session has looked. */
  world: World | null
  /** The rules of the profile in force, or '' when there are none to give. */
  brief: string
  /** The store's stamp when this was applied; '' before any write. */
  applied: string
  /** Personas that could not be read or registered. */
  problems: string[]
}

// Copies of the progress state's types in hooks/plan.ts and hooks/progress.ts.
export type Task = {
  key: string
  name: string
  number: number | null
  title: string
  from: number
  to: number
  steps: boolean[]
}
export type Tick = { at: number; kind: 'agent' | 'main' | 'fix' }
export type Mark = { agent: string | null; startedAt: number | null; stoppedAt: number | null; ticks: Tick[] }
export type AgentRun = {
  id: string
  type: string
  apart: boolean
  startedAt: number
  endedAt: number | null
  ended: 'completed' | 'failed' | 'stopped' | null
}
export type Tracker = { id: string; title: string; state: string; done: number | null; total: number | null; at: number }
export type Progress = {
  plan: string | null
  label: string
  unread: boolean
  anywhere: boolean
  tasks: Task[]
  marks: Record<string, Mark>
  agents: AgentRun[]
  tracker: Tracker | null
}

declare module 'claude-code' {
  /** The tool the mod registers, so a hook on it is typed like any other tool's. */
  interface McpToolInputs {
    mcp__tune__progress: {
      plan?: string
      tracker?: { id: string; title?: string; state?: string; done?: number; total?: number }
      clear?: boolean
    }
  }

  interface PluginState {
    tune: {
      view: Shaped<View>
      /** The main conversation's level as last seen on a request. */
      main: Shaped<Level | null>
      /** The rules this conversation has been given; null until the session has looked. */
      seenBrief: string | null
      /** The last command's answer, for the panel. */
      message: string | null
      /** Raised when an agent makes a request, so the panel's running list is drawn again. */
      tick: number
      /** Whether the panel shows the reasons. */
      why: boolean
      /** The profile a delete is waiting to have confirmed. */
      confirm: string | null
      /** The tracked plan's progress, for this session only. */
      progress: Shaped<Progress>
    }
  }
}

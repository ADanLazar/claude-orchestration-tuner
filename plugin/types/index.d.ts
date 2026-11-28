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

declare module 'claude-code' {
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
    }
  }
}

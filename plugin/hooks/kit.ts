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
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The message a call throws, or '' when it does not throw. */
export function failure(call: () => unknown): string {
  try {
    call()

    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

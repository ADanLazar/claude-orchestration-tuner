// The brief: a profile's working rules as text for the main conversation.
// Each dial value maps to a sentence or two.
import type { Profile } from './profile'

export const MAX_CHARS = 3000

/** Goes in front of the brief in the system prompt; not part of its limit. */
export const GUARD =
  'For the main conversation only. If a session started you as an agent, ignore this section.'

/** The rendered brief would exceed MAX_CHARS. */
export class BriefTooLong extends Error {}

const TEAM: Record<string, string> = {
  'when-split':
    'Decide first whether the job needs a team. Use subagents when the work splits into ' +
    'independent pieces that can run in parallel, or needs more reading than is worth holding ' +
    'in your own context. Do a small job, or one where each step depends on the last, yourself. ' +
    'Stay available to the person while agents run.',
  always:
    'Use a team for this job: plan it, hand the pieces to agents, and review what comes back. ' +
    'Stay available to the person while agents run.',
  never: 'Do this job yourself, without subagents. Ask the person before starting one.',
}
const HEADING = 'When you use a team:'
const DECISIONS =
  'You make the decisions: architecture, acceptance criteria, order of work. The planner turns ' +
  'them into a plan file, and implementers work from that file.'
// A specialist is named with the kind of work it is for, not in the general list.
const SPECIALISTS: Record<string, string> = {
  debugger: 'tune:debugger for a failure whose cause is not known',
  'security-reviewer':
    'tune:security-reviewer for a change that touches sign-in, permissions, payments or personal data',
  designer: 'tune:designer for user interface work',
}
const LEVELS = 'Each carries its own model and effort. Do not pass a model or an effort when you launch one'
const ESCALATE =
  'Escalate on failure: if a piece fails its tests or its review, redo it one effort level up, then one model up.'
const AGENTS: Record<string, string> = {
  'fresh-per-task':
    'Give each task in the plan to a fresh agent, and keep tasks small enough to finish in one ' +
    'run. Do not hand new work to an agent that has already finished a task.',
  'may-continue':
    'An agent may carry on with related tasks. Start a fresh one when its context grows large ' +
    'or the work changes subject.',
}
const REVIEW_TAIL = " Reviewers check the diff against the plan, not the implementer's summary."
const FIRST: Record<string, string> = {
  correct: 'correct behaviour of what ships comes first',
  time: 'elapsed time comes first',
  tokens: 'tokens come first',
}
const LATER: Record<string, string> = {
  correct: 'correct behaviour of what ships',
  time: 'elapsed time',
  tokens: 'tokens',
}
const CLOSING =
  "If any of this conflicts with the task or with the person's own instructions, the task and " +
  'the person win: say so in one line and carry on with your own judgment.'

/** "A", "A and B", or "A, B, and C": the phrases hold commas of their own. */
function sentenceList(items: string[]): string {
  if (items.length <= 2) {
    return items.join(' and ')
  }

  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function rolesBullet(profile: Profile): string {
  const names = Object.keys(profile.roles)
  const general = names.filter(name => !(name in SPECIALISTS)).map(name => `tune:${name}`)
  const special = Object.keys(SPECIALISTS)
    .filter(name => names.includes(name))
    .map(name => SPECIALISTS[name] as string)
  const sentences: string[] = []
  if (general.length > 0) {
    sentences.push(`Use the role agents: ${general.join(', ')}.`)
  }
  if (special.length > 0) {
    sentences.push(`Use ${sentenceList(special)}.`)
  }
  sentences.push(LEVELS + (profile.escalation ? ', except to escalate.' : '.'))

  return sentences.join(' ')
}

function reviewBullet(profile: Profile, areas: string): string {
  if (profile.review === 'each-task') {
    return `Review after each task.${REVIEW_TAIL}`
  }
  if (areas === '') {
    return `Review at each milestone.${REVIEW_TAIL}`
  }
  // With escalation on, the bullet above has just named the areas.
  if (profile.escalation) {
    return `Review at each milestone, and after each task in the areas named above.${REVIEW_TAIL}`
  }

  return `Review at each milestone, and after each task that touches ${areas}.${REVIEW_TAIL}`
}

function teamList(profile: Profile): string {
  const areas = profile.start_higher.join(', ')
  const bullets = [DECISIONS, rolesBullet(profile)]
  if (profile.escalation) {
    bullets.push(ESCALATE + (areas === '' ? '' : ` Start one level up where a mistake is expensive: ${areas}.`))
  }
  bullets.push(AGENTS[profile.agents] as string)
  bullets.push(reviewBullet(profile, areas))

  return [HEADING, ...bullets.map(bullet => `- ${bullet}`)].join('\n')
}

/** Paragraphs separated by one blank line; each paragraph and bullet on one line. */
export function render(profile: Profile): string {
  const [first, second, third] = profile.order as [string, string, string]
  const parts = [
    `Tune profile: ${profile.name}. These are the working rules for this machine. ` +
      'The person you are working with changes them with /tune.',
    TEAM[profile.team] as string,
  ]
  if (profile.team !== 'never') {
    parts.push(teamList(profile))
  }
  parts.push(`When goals conflict: ${FIRST[first]}, then ${LATER[second]}, then ${LATER[third]}.`)
  for (const text of [profile.tests, profile.notes]) {
    if (text !== '') {
      parts.push(text)
    }
  }
  parts.push(CLOSING)

  const text = `${parts.join('\n\n')}\n`
  if (text.length > MAX_CHARS) {
    throw new BriefTooLong(
      `the brief for '${profile.name}' is ${text.length} characters; the limit is ${MAX_CHARS}`,
    )
  }

  return text
}

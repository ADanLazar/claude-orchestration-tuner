import { expect, test } from 'claude-code/testing'

import { BriefTooLong, MAX_CHARS, render } from './brief'
import { BUILD, copy, failure } from './kit'

// The approved words: the design's "The brief" section, each paragraph and bullet on one line.
const SHIPPED = [
  'Tune profile: build. These are the working rules for this machine. The person you are working with changes them with /tune.',
  '',
  'Decide first whether the job needs a team. Use subagents when the work splits into independent pieces that can run in parallel, or needs more reading than is worth holding in your own context. Do a small job, or one where each step depends on the last, yourself. Stay available to the person while agents run.',
  '',
  'When you use a team:',
  '- You make the decisions: architecture, acceptance criteria, order of work. The planner turns them into a plan file, and implementers work from that file.',
  '- Use the role agents: tune:planner, tune:executor, tune:code-reviewer, tune:test-engineer, tune:writer. Use tune:debugger for a failure whose cause is not known, tune:security-reviewer for a change that touches sign-in, permissions, payments or personal data, and tune:designer for user interface work. Each carries its own model and effort. Do not pass a model or an effort when you launch one, except to escalate.',
  '- Escalate on failure: if a piece fails its tests or its review, redo it one effort level up, then one model up. Start one level up where a mistake is expensive: sign-in, permissions, payments, data migrations.',
  '- Give each task in the plan to a fresh agent, and keep tasks small enough to finish in one run. Do not hand new work to an agent that has already finished a task.',
  "- Review at each milestone, and after each task in the areas named above. Reviewers check the diff against the plan, not the implementer's summary.",
  '',
  'When goals conflict: correct behaviour of what ships comes first, then elapsed time, then tokens.',
  '',
  'Tests: roughly one focused test per stated behaviour, and more only where a failure would lose data, money or access. Run the tests for the changed area after each change and the whole suite once before each milestone. Do not keep scratch checks as test files.',
  '',
  "If any of this conflicts with the task or with the person's own instructions, the task and the person win: say so in one line and carry on with your own judgment.",
  '',
].join('\n')

test('the shipped profile renders the approved words', () => {
  expect(render(BUILD)).toBe(SHIPPED)
})

test('team never drops the team list', () => {
  const text = render({ ...copy(BUILD), team: 'never' })

  expect(text.split('\n').some(line => line.startsWith('- '))).toBe(false)
  expect(text).toContain('Ask the person before starting one.')
})

test('a profile without specialists names none; with one, names that one', () => {
  const five = copy(BUILD)
  delete five.roles.debugger
  delete five.roles['security-reviewer']
  delete five.roles.designer
  expect(render(five)).not.toContain('tune:debugger')
  expect(render(five)).toContain('tune:writer. Each carries its own model and effort.')

  const six = copy(five)
  six.roles.designer = { model: 'sonnet', effort: 'medium' }
  expect(render(six)).toContain('tune:writer. Use tune:designer for user interface work. Each carries')

  const seven = copy(six)
  seven.roles.debugger = { model: 'sonnet', effort: 'high' }
  expect(render(seven)).toContain(
    'Use tune:debugger for a failure whose cause is not known and tune:designer for user interface work. Each carries',
  )
})

test('escalation off', () => {
  const text = render({ ...copy(BUILD), escalation: false })

  expect(text).toContain('Do not pass a model or an effort when you launch one.\n')
  expect(text).not.toContain('- Escalate')
  expect(text).toContain('- Review at each milestone, and after each task that touches sign-in, permissions, payments, data migrations.')
})

test('the other choices each have their sentence', () => {
  const text = render({
    ...copy(BUILD),
    team: 'always',
    agents: 'may-continue',
    review: 'each-task',
    order: ['tokens', 'correct', 'time'],
    notes: 'Ask before adding a dependency.',
  })

  expect(text).toContain('Use a team for this job')
  expect(text).toContain('- An agent may carry on with related tasks.')
  expect(text).toContain('- Review after each task. Reviewers check')
  expect(text).toContain('When goals conflict: tokens come first, then correct behaviour of what ships, then elapsed time.')
  expect(text).toContain('\n\nAsk before adding a dependency.\n\nIf any of this conflicts')
})

test('a brief over the limit is refused', () => {
  const message = failure(() => render({ ...copy(BUILD), notes: 'x'.repeat(MAX_CHARS) }))

  expect(message).toContain(String(MAX_CHARS))
  expect(message).toMatch(/is \d{4} characters/)
  expect(() => render({ ...copy(BUILD), notes: 'x'.repeat(MAX_CHARS) })).toThrow(BriefTooLong)
})

import { expect, test } from 'claude-code/testing'

import { BUILD, copy, failure } from './kit'
import { fill, setDial, validate } from './profile'

test('validate accepts the shipped shape and returns a copy', () => {
  const input = copy(BUILD)
  const checked = validate(input)

  expect(checked).toEqual(BUILD)
  expect(checked).not.toBe(input)
  expect(checked.roles).not.toBe(input.roles)
})

test('validate names the field', () => {
  const effort = copy(BUILD)
  effort.roles.executor!.effort = 'huge'
  expect(failure(() => validate(effort))).toBe('roles.executor.effort: must be one of low, medium, high, xhigh, max')

  const missing: Record<string, unknown> = copy(BUILD)
  delete missing.order
  expect(failure(() => validate(missing))).toBe('order: is missing')

  expect(failure(() => validate({ ...copy(BUILD), colour: 'red' }))).toBe('colour: is not a dial Tune knows')
  expect(failure(() => validate({ ...copy(BUILD), name: 'Fast' }))).toMatch(/^name: /)
  expect(failure(() => validate('build'))).toBe('a profile must be a JSON object')
})

test('validate accepts a full model id', () => {
  const full = copy(BUILD)
  full.roles.planner!.model = 'claude-opus-5-5'
  expect(validate(full).roles.planner!.model).toBe('claude-opus-5-5')

  full.roles.planner!.model = 'gpt'
  expect(failure(() => validate(full))).toMatch(/^roles\.planner\.model: /)
})

test('setDial changes one dial and leaves the input alone', () => {
  const before = copy(BUILD)

  expect(setDial(before, 'roles.executor.effort', 'high').roles.executor!.effort).toBe('high')
  expect(setDial(before, 'main.model', 'opus').main.model).toBe('opus')
  expect(setDial(before, 'escalation', 'off').escalation).toBe(false)
  expect(setDial(before, 'order', 'time, correct, tokens').order).toEqual(['time', 'correct', 'tokens'])
  expect(setDial(before, 'start_higher', 'a, b').start_higher).toEqual(['a', 'b'])
  expect(setDial(before, 'notes', 'Ask first.').notes).toBe('Ask first.')
  expect(before).toEqual(BUILD)
})

test('setDial refuses a value or a dial it does not know', () => {
  expect(failure(() => setDial(BUILD, 'escalation', 'maybe'))).toBe('escalation: use on or off')
  expect(failure(() => setDial(BUILD, 'roles.nobody.model', 'opus'))).toBe(
    "roles.nobody.model: the profile has no role named 'nobody'",
  )
  expect(failure(() => setDial(BUILD, 'team', 'sometimes'))).toBe('team: must be one of when-split, always, never')
  expect(failure(() => setDial(BUILD, 'volume', '11'))).toBe('volume: is not a dial Tune knows')
  expect(failure(() => setDial(BUILD, 'name', 'other'))).toBe('name: is not a dial Tune knows')
})

test('fill takes what an older profile lacks from the shipped one', () => {
  const older: any = copy(BUILD)
  older.name = 'fast'
  delete older.roles.designer
  delete older.agents
  older.roles.ghost = { model: 'opus', effort: 'low' }
  older.old = true
  older.roles.executor.effort = 'low'

  const { profile, filled } = fill(older, BUILD)

  expect(profile.name).toBe('fast')
  expect(profile.roles.designer).toEqual({ model: 'sonnet', effort: 'medium' })
  expect(profile.agents).toBe('fresh-per-task')
  expect(profile.roles.executor!.effort).toBe('low')
  expect('ghost' in profile.roles).toBe(false)
  expect('old' in profile).toBe(false)
  expect(filled).toEqual(['agents', 'roles.designer'])
  expect(Object.keys(profile.roles)).toEqual(Object.keys(BUILD.roles))
})

test('fill of a complete profile fills nothing', () => {
  expect(fill(copy(BUILD), BUILD)).toEqual({ profile: BUILD, filled: [] })
})

test('fill refuses what is not a profile at all, or still does not validate', () => {
  expect(failure(() => fill(null, BUILD))).toBe('a profile must be a JSON object')

  const bad: any = copy(BUILD)
  bad.roles.executor.effort = 'huge'
  expect(failure(() => fill(bad, BUILD))).toMatch(/^roles\.executor\.effort: /)
})

test('validate names a wrong questions or reports value', () => {
  expect(failure(() => validate({ ...copy(BUILD), questions: 'sometimes' }))).toBe(
    'questions: must be one of when-unclear, always, never',
  )
  expect(failure(() => validate({ ...copy(BUILD), reports: 'hourly' }))).toBe(
    'reports: must be one of each-milestone, each-task, on-request',
  )
  const missing: Record<string, unknown> = copy(BUILD)
  delete missing.reports
  expect(failure(() => validate(missing))).toBe('reports: is missing')
})

test('setDial changes questions and reports', () => {
  expect(setDial(BUILD, 'questions', 'never').questions).toBe('never')
  expect(failure(() => setDial(BUILD, 'reports', 'daily'))).not.toBe('')
})

test('fill gives a profile saved by 0.1.0 the two dials', () => {
  const older: Record<string, unknown> = copy(BUILD)
  delete older.questions
  delete older.reports
  const { profile, filled } = fill(older, BUILD)

  expect(profile.questions).toBe('when-unclear')
  expect(profile.reports).toBe('each-milestone')
  expect(filled).toEqual(['questions', 'reports'])
})

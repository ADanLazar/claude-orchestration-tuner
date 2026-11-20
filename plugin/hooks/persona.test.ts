import { expect, test } from 'claude-code/testing'

import { failure } from './kit'
import { parsePersona, PersonaError } from './persona'

const FILE = [
  '---',
  'name: code-reviewer',
  'description: Use to review a change: the diff against its plan.',
  'model: opus',
  'effort: medium',
  'disallowedTools: Write, Edit',
  'colour: blue',
  '---',
  '',
  'You review a change.',
  '',
  '## Do',
  '',
  '- Read the plan first.',
  '',
].join('\n')

test('a persona file parses', () => {
  expect(parsePersona(FILE)).toEqual({
    name: 'code-reviewer',
    description: 'Use to review a change: the diff against its plan.',
    model: 'opus',
    effort: 'medium',
    disallowedTools: ['Write', 'Edit'],
    prompt: 'You review a change.\n\n## Do\n\n- Read the plan first.',
  })
})

test('a file without tool lines has neither key', () => {
  const parsed = parsePersona(FILE.replace('disallowedTools: Write, Edit\n', ''))

  expect('disallowedTools' in parsed).toBe(false)
  expect('tools' in parsed).toBe(false)
  expect(parsePersona(FILE.replace('disallowedTools: Write, Edit', 'tools: Read, Grep')).tools).toEqual(['Read', 'Grep'])
})

test('Windows line endings parse the same', () => {
  expect(parsePersona(FILE.replace(/\n/g, '\r\n'))).toEqual(parsePersona(FILE))
})

test('a file without a header, a closing line, a name, a description or a prompt is refused', () => {
  expect(() => parsePersona('You review a change.')).toThrow(PersonaError)
  expect(failure(() => parsePersona('---\nname: x\ndescription: y\n\nBody'))).toBe('the header has no closing --- line')
  expect(failure(() => parsePersona(FILE.replace('name: code-reviewer\n', '')))).toBe('the header has no name')
  expect(failure(() => parsePersona(FILE.replace(/description: .*\n/, '')))).toBe('the header has no description')
  expect(failure(() => parsePersona('---\nname: x\ndescription: y\nmodel: opus\neffort: low\n---\n\n  \n'))).toBe('there is no prompt after the header')
})

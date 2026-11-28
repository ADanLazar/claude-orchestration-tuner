import { expect, test } from 'claude-code/testing'

import { baseName, linkByPrompt, mdPaths, readPlan, relativeTo, resolvePath, touched } from './plan'

const PLAN = [
  '# Export to CSV',
  '',
  'The export writes the rows of a table to a file.',
  '',
  '### Task 1: Read the file',
  '- [x] Open the file',
  '- [ ] Parse the rows',
  '',
  '## Notes',
  'Nothing to tick here.',
  '',
  '### Task 2: Write the rows',
  '- [ ] Write each row',
].join('\n')

const steps = (text: string): boolean[][] => readPlan(text, 'plan.md').map(task => task.steps)

test('a heading with boxes under it is a task', () => {
  const tasks = readPlan(PLAN, 'export.md')

  expect(tasks.map(task => task.name)).toEqual(['Task 1: Read the file', 'Task 2: Write the rows'])
  expect(tasks.map(task => task.number)).toEqual([1, 2])
  expect(tasks.map(task => task.title)).toEqual(['Read the file', 'Write the rows'])
  expect(tasks.map(task => task.steps)).toEqual([[true, false], [false]])
  expect(tasks.map(task => [task.from, task.to])).toEqual([
    [4, 7],
    [11, 12],
  ])
})

test('any bullet, either mark, any indent', () => {
  expect(steps('# A\n* [ ] a\n+ [X] b\n    - [x] c\n\t- [ ] d')).toEqual([[false, true, true, false]])
  expect(steps('# A\n- [] e\n- [y] f\n-[ ] g\n[ ] h\n- [ ]i')).toEqual([])
})

test('lines inside a fenced block are skipped', () => {
  expect(steps('# A\n- [ ] a\n```\n- [ ] no\n# No\n- [ ] no\n```\n- [x] b')).toEqual([[false, true]])
  expect(steps('# A\n- [ ] a\n~~~md\n# No\n- [ ] no\n~~~\n- [x] b')).toEqual([[false, true]])
  expect(steps('# A\n- [ ] a\n````\n```\n- [ ] no\n```\n- [ ] no\n````\n- [x] b')).toEqual([[false, true]])
  expect(steps('# A\n- [ ] a\n```\n# B\n- [ ] no')).toEqual([[false]])
})

test('boxes before the first heading make one task named after the file', () => {
  const tasks = readPlan('- [ ] a\n- [x] b\n\n# Later\n- [ ] c', 'todo.md')

  expect(tasks[0]).toEqual({ key: 'todo.md', name: 'todo.md', number: null, title: 'todo.md', from: -1, to: 2, steps: [false, true] })
  expect(tasks[1]!.name).toBe('Later')
  expect(tasks.length).toBe(2)
})

test('Windows line endings and a byte-order mark read the same', () => {
  expect(readPlan(`\uFEFF${PLAN.replace(/\n/g, '\r\n')}`, 'export.md')).toEqual(readPlan(PLAN, 'export.md'))
})

test('two tasks with the same heading get different keys', () => {
  expect(readPlan('## Tests\n- [ ] a\n## Tests\n- [ ] b', 'plan.md').map(task => task.key)).toEqual(['Tests', 'Tests #2'])
})

test('closing #s are dropped and the number is read', () => {
  const [task] = readPlan('## Task 3 - Ship it ##\n- [ ] a', 'plan.md')

  expect([task!.name, task!.number, task!.title]).toEqual(['Task 3 - Ship it', 3, 'Ship it'])
})

test('an empty file and a file with no box give no task', () => {
  expect(readPlan('', 'plan.md')).toEqual([])
  expect(readPlan('# Export to CSV\nSome words.\n## Notes', 'plan.md')).toEqual([])
})

test('touched names the task an edit landed in', () => {
  const tasks = readPlan(PLAN, 'export.md')

  expect(touched(tasks, PLAN, '- [ ] Write each row')).toBe(1)
  expect(touched(tasks, PLAN, 'the rows')).toBe(null)
  expect(touched(tasks, PLAN, 'not in the file')).toBe(null)
  expect(touched(tasks, PLAN, '')).toBe(null)
})

test('linkByPrompt', () => {
  const tasks = readPlan(PLAN, 'export.md')

  expect(linkByPrompt(tasks, 'Implement Task 2 of the plan')).toBe(1)
  expect(linkByPrompt(tasks, 'Task 2, which follows Task 1')).toBe(null)
  expect(linkByPrompt(tasks, 'Task 2 first, and only Task 2')).toBe(1)
  expect(linkByPrompt(tasks, 'Implement Task 9')).toBe(null)

  const plain = readPlan('## Read the file\n- [ ] a\n## Write the rows\n- [ ] b', 'export.md')
  expect(linkByPrompt(plain, 'Please do "Write the rows" next')).toBe(1)
  expect(linkByPrompt(plain, 'Read the file, then Write the rows')).toBe(null)
  expect(linkByPrompt(plain, 'Add the tests')).toBe(null)
})

test('mdPaths finds the plan paths a prompt names', () => {
  expect(mdPaths('Do Task 2 of docs/plans/export.md, then see "/work/my notes/plan two.md" and `other.md`.')).toEqual([
    'docs/plans/export.md',
    '/work/my notes/plan two.md',
    'other.md',
  ])
  expect(mdPaths('Implement Task 2 of the plan')).toEqual([])
})

test('paths resolve, shorten and give their file name', () => {
  expect(resolvePath('/work', 'docs/a.md')).toBe('/work/docs/a.md')
  expect(resolvePath('/work', '/x/./y/../a.md')).toBe('/x/a.md')
  expect(resolvePath('C:\\work', 'docs\\a.md')).toBe('C:/work/docs/a.md')
  expect(relativeTo('/work', '/work/docs/a.md')).toBe('docs/a.md')
  expect(relativeTo('/work', '/else/a.md')).toBe('/else/a.md')
  expect(baseName('/work/docs/a.md')).toBe('a.md')
})

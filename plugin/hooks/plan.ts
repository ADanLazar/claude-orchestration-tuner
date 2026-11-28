// Reads the text of a Markdown plan file into tasks (headings) and steps
// (checkboxes), and works out the paths a prompt names. It imports nothing:
// scripts/check.mjs loads it with plain Node.

export type Task = {
  key: string
  name: string
  number: number | null
  title: string
  from: number
  to: number
  steps: boolean[]
}

const HEADING = /^#{1,6} (.*)$/
const STEP = /^[ \t]*[-*+] \[([ xX])\](?: |$)/
const FENCE = /^[ \t]*(`{3,}|~{3,})/
const NUMBERED = /^task\s+(\d+)/i

// A checkout on Windows may hold \r\n, and an editor there may add a byte-order mark.
const plain = (text: string): string => text.replace(/^﻿/, '').replace(/\r\n/g, '\n')

export function readPlan(text: string, fileName: string): Task[] {
  const lines = plain(text).split('\n')
  const tasks: Task[] = []
  const seen: Record<string, number> = {}
  let current: Omit<Task, 'key' | 'number' | 'title'> = { name: fileName, from: -1, to: -1, steps: [] }
  let fence: string | null = null

  const close = (to: number): void => {
    if (current.steps.length === 0) return
    const count = (seen[current.name] ?? 0) + 1
    seen[current.name] = count
    const numbered = current.from < 0 ? null : NUMBERED.exec(current.name)
    tasks.push({
      key: count === 1 ? current.name : `${current.name} #${count}`,
      name: current.name,
      number: numbered ? Number(numbered[1]) : null,
      title: numbered ? current.name.slice(numbered[0].length).replace(/^\s*[:.-]?\s*/, '') : current.name,
      from: current.from,
      to,
      steps: current.steps,
    })
  }

  lines.forEach((line, index) => {
    if (fence !== null) {
      const trimmed = line.trim()
      if (trimmed.length >= fence.length && trimmed === fence[0].repeat(trimmed.length)) fence = null
      return
    }
    const opening = FENCE.exec(line)
    if (opening) {
      fence = opening[1]
      return
    }
    const heading = HEADING.exec(line)
    if (heading) {
      // Closing #s, after a space, are not part of the text.
      const name = heading[1].replace(/(?:^|\s)#+\s*$/, '').trim()
      close(index - 1)
      current = { name, from: index, to: -1, steps: [] }
      return
    }
    const step = STEP.exec(line)
    if (step) current.steps.push(step[1] !== ' ')
  })
  close(lines.length - 1)
  return tasks
}

export function touched(tasks: Task[], text: string, fragment: string): number | null {
  const body = plain(text)
  const piece = fragment.replace(/\r\n/g, '\n')
  if (piece === '') return null
  const at = body.indexOf(piece)
  if (at < 0 || body.indexOf(piece, at + 1) >= 0) return null
  const line = body.slice(0, at).split('\n').length - 1
  const index = tasks.findIndex(task => Math.max(task.from, 0) <= line && line <= task.to)
  return index < 0 ? null : index
}

export function linkByPrompt(tasks: Task[], prompt: string): number | null {
  const numbers = new Set([...prompt.matchAll(/\btask\s+(\d+)/gi)].map(match => Number(match[1])))
  if (numbers.size > 1) return null
  if (numbers.size === 1) {
    const [wanted] = numbers
    const index = tasks.findIndex(task => task.number === wanted)
    return index < 0 ? null : index
  }
  const named = tasks.flatMap((task, index) => (task.name !== '' && prompt.includes(task.name) ? [index] : []))
  return named.length === 1 ? named[0] : null
}

export function mdPaths(prompt: string): string[] {
  const found: string[] = []
  for (const match of prompt.matchAll(/`([^`]+)`|"([^"]+)"|(\S+)/g)) {
    const path = (match[1] ?? match[2] ?? match[3]).replace(/[.,;:!?)\]}>'"`]+$/, '')
    if (path.endsWith('.md') && !found.includes(path)) found.push(path)
  }
  return found
}

export function resolvePath(cwd: string, path: string): string {
  const absolute = /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)
  const joined = (absolute ? path : `${cwd}/${path}`).replace(/\\/g, '/')
  const root = /^(?:\/|[A-Za-z]:\/)/.exec(joined)?.[0] ?? ''
  const parts: string[] = []
  for (const part of joined.slice(root.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return root + parts.join('/')
}

export function relativeTo(cwd: string, path: string): string {
  const base = cwd.replace(/[\\/]+$/, '')
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

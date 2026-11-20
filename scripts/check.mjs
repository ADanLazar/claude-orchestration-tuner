#!/usr/bin/env node
// Checks that need the real files, which a mod's own tests cannot read:
// the persona files against the shipped profile, and words that must not ship.
// Run from anywhere: node scripts/check.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(root, 'plugin')
const faults = []
const fault = (file, why) => faults.push(`${relative(root, file) || '.'}: ${why}`)

const PROMPT_LIMIT = 2500
// Files that may name the owner; this script names the words it looks for.
const MAY_NAME_OWNER = new Set(
  ['LICENSE', '.claude-plugin/marketplace.json', 'plugin/.claude-plugin/plugin.json', 'scripts/check.mjs'].map(p =>
    p.split('/').join(sep),
  ),
)
const FORBIDDEN = /\bDan\b|\bomc\b|oh-my-?claude/i
const HEADER_KEYS = new Set(['name', 'description', 'model', 'effort', 'disallowedTools'])
// Personas that report and must never edit.
const READ_ONLY = new Set(['code-reviewer', 'security-reviewer'])

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fault(file, `not valid JSON (${error.message})`)

    return null
  }
}

/** The header keys and the body of an agent file, or null when it has no header. */
function readAgent(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') {
    return null
  }
  const end = lines.indexOf('---', 1)
  if (end < 0) {
    return null
  }
  const keys = {}
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      keys[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
    }
  }

  return { keys, body: lines.slice(end + 1).join('\n').trim() }
}

/** Every file git would ship or could be asked to: tracked, or new and not ignored. */
function shippable() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })

  return out
    .split('\0')
    .filter(name => name !== '')
    .map(name => join(root, name))
    .filter(existsSync)
}

const profile = readJson(join(plugin, 'profiles', 'build.json'))
readJson(join(plugin, 'notes.json'))
const manifest = readJson(join(plugin, '.claude-plugin', 'plugin.json'))
if (manifest && !/^\d+\.\d+\.\d+$/.test(String(manifest.version))) {
  fault(join(plugin, '.claude-plugin', 'plugin.json'), `version "${manifest.version}" is not x.y.z`)
}

const agentsDir = join(plugin, 'agents')
const files = readdirSync(agentsDir).filter(name => name.endsWith('.md'))
const roles = profile?.roles ?? {}
for (const role of Object.keys(roles)) {
  if (!files.includes(`${role}.md`)) {
    fault(join(agentsDir, `${role}.md`), 'the shipped profile names this persona and it has no file')
  }
}
for (const name of files) {
  const file = join(agentsDir, name)
  const role = name.slice(0, -3)
  const agent = readAgent(readFileSync(file, 'utf8'))
  if (!agent) {
    fault(file, 'no header between two --- lines')
    continue
  }
  const level = roles[role]
  if (!level) {
    fault(file, 'no persona of this name in the shipped profile')
  }
  if (agent.keys.name !== role) {
    fault(file, `name is "${agent.keys.name}", the file says "${role}"`)
  }
  if (!agent.keys.description) {
    fault(file, 'no description')
  } else if (agent.keys.description.length > 200 || !agent.keys.description.startsWith('Use')) {
    fault(file, 'the description must start with "Use" and be at most 200 characters')
  }
  for (const field of ['model', 'effort']) {
    if (level && agent.keys[field] !== level[field]) {
      fault(file, `${field} is "${agent.keys[field]}", the shipped profile says "${level[field]}"`)
    }
  }
  for (const key of Object.keys(agent.keys)) {
    if (!HEADER_KEYS.has(key)) {
      fault(file, `header key "${key}" is not one a persona file carries`)
    }
  }
  if (READ_ONLY.has(role) && agent.keys.disallowedTools !== 'Write, Edit') {
    fault(file, 'a reviewer must carry "disallowedTools: Write, Edit"')
  }
  if (agent.body.length === 0) {
    fault(file, 'no prompt')
  } else if (agent.body.length > PROMPT_LIMIT) {
    fault(file, `the prompt is ${agent.body.length} characters; the limit is ${PROMPT_LIMIT}`)
  }
}

for (const file of shippable()) {
  if (MAY_NAME_OWNER.has(relative(root, file)) || /\.(png|jpg)$/.test(file)) {
    continue
  }
  const hit = readFileSync(file, 'utf8').match(FORBIDDEN)
  if (hit) {
    fault(file, `holds "${hit[0]}", which must not ship`)
  }
}

// The mod's own code against the real files. Its modules are TypeScript with
// only types to strip, which Node 23.6 and later load as they are.
try {
  const hooks = join(plugin, 'hooks')
  const { validate } = await import(pathToFileURL(join(hooks, 'profile.ts')).href)
  const { render, MAX_CHARS } = await import(pathToFileURL(join(hooks, 'brief.ts')).href)
  const { parsePersona } = await import(pathToFileURL(join(hooks, 'persona.ts')).href)
  const { BUILD } = await import(pathToFileURL(join(hooks, 'kit.ts')).href)
  const shippedFile = join(plugin, 'profiles', 'build.json')
  try {
    const checked = validate(profile)
    if (JSON.stringify(checked) !== JSON.stringify(BUILD)) {
      fault(shippedFile, 'differs from BUILD in hooks/kit.ts, which the tests use as the shipped profile')
    }
    if (render(checked).length > MAX_CHARS) {
      fault(shippedFile, 'its rules are longer than the limit')
    }
  } catch (error) {
    fault(shippedFile, `the mod refuses it (${error.message})`)
  }
  for (const name of files) {
    try {
      parsePersona(readFileSync(join(agentsDir, name), 'utf8'))
    } catch (error) {
      fault(join(agentsDir, name), `the mod cannot read it (${error.message})`)
    }
  }
} catch (error) {
  fault(join(plugin, 'hooks'), `the mod's modules could not be loaded; this check needs Node 23.6 or later (${error.message})`)
}

if (faults.length > 0) {
  console.error(faults.join('\n'))
  process.exit(1)
}
console.log('check: ok')

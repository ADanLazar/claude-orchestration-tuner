#!/usr/bin/env node
// Checks that need the real files, which a mod's own tests cannot read:
// the persona files against the shipped profile, and words that must not ship.
// Run from anywhere: node scripts/check.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const FORBIDDEN = /\bDan\b|omc|oh-my/i
const SKIP_DIRS = new Set(['.git', '.superpowers', 'node_modules', 'types'])

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

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) {
        walk(path, found)
      }
    } else {
      found.push(path)
    }
  }

  return found
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
  if (agent.body.length === 0) {
    fault(file, 'no prompt')
  } else if (agent.body.length > PROMPT_LIMIT) {
    fault(file, `the prompt is ${agent.body.length} characters; the limit is ${PROMPT_LIMIT}`)
  }
}

for (const file of walk(root)) {
  if (MAY_NAME_OWNER.has(relative(root, file)) || /\.(png|jpg)$/.test(file)) {
    continue
  }
  const hit = readFileSync(file, 'utf8').match(FORBIDDEN)
  if (hit) {
    fault(file, `holds "${hit[0]}", which must not ship`)
  }
}

if (faults.length > 0) {
  console.error(faults.join('\n'))
  process.exit(1)
}
console.log('check: ok')

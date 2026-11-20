// Reads one of the plugin's own agent files: a header of `key: value` lines
// between two `---` lines, then the prompt.

export type Persona = {
  name: string
  description: string
  model: string
  effort: string
  tools?: string[]
  disallowedTools?: string[]
  prompt: string
}

/** An agent file is not in the shape a persona file has. */
export class PersonaError extends Error {}

const list = (value: string): string[] =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')

export function parsePersona(text: string): Persona {
  // A checkout on Windows may hold \r\n.
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') {
    throw new PersonaError('the file does not start with a --- line')
  }
  const end = lines.indexOf('---', 1)
  if (end < 0) {
    throw new PersonaError('the header has no closing --- line')
  }

  const keys: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      // Only the first colon divides: a description may hold more.
      keys[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
    }
  }
  const prompt = lines
    .slice(end + 1)
    .join('\n')
    .trim()

  for (const key of ['name', 'description', 'model', 'effort']) {
    if (!keys[key]) {
      throw new PersonaError(`the header has no ${key}`)
    }
  }
  if (prompt === '') {
    throw new PersonaError('there is no prompt after the header')
  }

  const persona: Persona = {
    name: keys.name as string,
    description: keys.description as string,
    model: keys.model as string,
    effort: keys.effort as string,
    prompt,
  }
  if (keys.tools) {
    persona.tools = list(keys.tools)
  }
  if (keys.disallowedTools) {
    persona.disallowedTools = list(keys.disallowedTools)
  }

  return persona
}

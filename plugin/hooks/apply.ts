// Puts a profile's levels on the role agents: each persona file is read from
// the plugin's folder and registered again with the profile's model and effort.
import { parsePersona } from './persona'
import type { Profile } from './profile'
import type { Io } from './store'

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** One line for each persona that could not be read or registered. Never rejects. */
export async function apply(io: Io, profile: Profile): Promise<string[]> {
  const outcomes = await Promise.all(
    Object.entries(profile.roles).map(async ([role, level]) => {
      let persona
      try {
        persona = parsePersona(await io.read(`${io.root}/agents/${role}.md`))
      } catch (error) {
        return `${role}: could not be read (${reason(error)})`
      }
      try {
        await io.register({
          name: role,
          description: persona.description,
          prompt: persona.prompt,
          model: level.model,
          effort: level.effort,
          ...(persona.tools ? { tools: persona.tools } : {}),
          ...(persona.disallowedTools ? { disallowedTools: persona.disallowedTools } : {}),
        })
      } catch (error) {
        return `${role}: could not be registered (${reason(error)})`
      }

      return null
    }),
  )

  return outcomes.filter((line): line is string => line !== null)
}

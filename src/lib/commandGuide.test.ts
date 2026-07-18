import { describe, expect, test } from 'vitest'
import { program } from '../index.ts'
import { COMMAND_GUIDE, cliCommandName } from './commandGuide.ts'
import { generatePortSkillMarkdown } from '../../scripts/generate-port-skill.ts'

function guideEntryByCliName(): Map<string, (typeof COMMAND_GUIDE)[number]> {
  return new Map(
    COMMAND_GUIDE.flatMap(entry => {
      const name = cliCommandName(entry)
      return name ? [[name, entry]] : []
    })
  )
}

describe('command guide coverage', () => {
  test('documents every registered Commander command', () => {
    const documented = guideEntryByCliName()
    const commandNames = program.commands
      .map(command => command.name())
      .sort((a, b) => a.localeCompare(b))

    expect([...documented.keys()].sort((a, b) => a.localeCompare(b))).toEqual(commandNames)
  })

  test('keeps documented aliases in sync with Commander aliases', () => {
    const documented = guideEntryByCliName()

    for (const command of program.commands) {
      const entry = documented.get(command.name())
      expect(entry, `Missing command guide entry for ${command.name()}`).toBeDefined()
      expect(entry?.aliases ?? []).toEqual(command.aliases())
    }
  })

  test('generated skill includes every documented command', () => {
    const markdown = generatePortSkillMarkdown()

    for (const entry of COMMAND_GUIDE) {
      expect(markdown).toContain(`\`${entry.command}\``)
    }
  })
})

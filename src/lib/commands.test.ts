import { describe, expect, test } from 'vitest'
import {
  findSimilarCommand,
  isReservedCommand,
  getSubcommands,
  getBranchCommands,
  getShellCommands,
  getCommandFlags,
  getGlobalFlags,
  getCommandDescriptions,
} from './commands.ts'

describe('command name helpers', () => {
  test('recognizes reserved commands and aliases', () => {
    expect(isReservedCommand('install')).toBe(true)
    expect(isReservedCommand('ls')).toBe(true)
    expect(isReservedCommand('urls')).toBe(true)
    expect(isReservedCommand('feature/install-docs')).toBe(false)
  })

  test('finds likely typos against known commands', () => {
    expect(findSimilarCommand('instal')).toMatchObject({ command: 'install', distance: 1 })
    expect(findSimilarCommand('staus')).toMatchObject({ command: 'status', distance: 1 })
  })

  test('finds likely typos against command aliases', () => {
    expect(findSimilarCommand('l')).toMatchObject({ command: 'ls', distance: 1 })
  })

  test('ignores exact commands and branch-like names', () => {
    expect(findSimilarCommand('cleanup')).toBeNull()
    expect(findSimilarCommand('feature/install-docs')).toBeNull()
  })
})

describe('getSubcommands', () => {
  test('includes primary command names', () => {
    const cmds = getSubcommands()
    expect(cmds).toContain('init')
    expect(cmds).toContain('enter')
    expect(cmds).toContain('remove')
    expect(cmds).toContain('list')
    expect(cmds).toContain('status')
    expect(cmds).toContain('up')
    expect(cmds).toContain('down')
    expect(cmds).toContain('completion')
  })

  test('includes aliases', () => {
    const cmds = getSubcommands()
    expect(cmds).toContain('ls')
    expect(cmds).toContain('rm')
    expect(cmds).toContain('dc')
  })

  test('includes the implicit help command', () => {
    expect(getSubcommands()).toContain('help')
  })

  test('does not include branch-like names', () => {
    const cmds = getSubcommands()
    expect(cmds.some(c => c.includes('/'))).toBe(false)
  })
})

describe('getBranchCommands', () => {
  test('returns commands that accept a <branch> argument', () => {
    const cmds = getBranchCommands()
    expect(cmds).toContain('enter')
    expect(cmds).toContain('remove')
  })

  test('includes aliases of branch-accepting commands', () => {
    const cmds = getBranchCommands()
    expect(cmds).toContain('rm')
  })

  test('does not include commands without a branch argument', () => {
    const cmds = getBranchCommands()
    expect(cmds).not.toContain('init')
    expect(cmds).not.toContain('up')
    expect(cmds).not.toContain('list')
    expect(cmds).not.toContain('status')
  })
})

describe('getShellCommands', () => {
  test('returns commands that accept a <shell> argument', () => {
    const cmds = getShellCommands()
    expect(cmds).toContain('shell-hook')
    expect(cmds).toContain('completion')
  })

  test('does not include unrelated commands', () => {
    const cmds = getShellCommands()
    expect(cmds).not.toContain('enter')
    expect(cmds).not.toContain('init')
  })
})

describe('getCommandFlags', () => {
  test('returns flags for commands with options', () => {
    const flags = getCommandFlags()
    expect(flags['remove']).toContain('--force')
    expect(flags['remove']).toContain('-f')
    expect(flags['remove']).toContain('--keep-branch')
  })

  test('includes flags for aliases', () => {
    const flags = getCommandFlags()
    expect(flags['rm']).toEqual(flags['remove'])
    expect(flags['ls']).toEqual(flags['list'])
  })

  test('does not include commands with no options', () => {
    const flags = getCommandFlags()
    expect(flags['init']).toBeUndefined()
    expect(flags['up']).toBeUndefined()
    expect(flags['status']).toBeUndefined()
  })

  test('returns install flags', () => {
    const flags = getCommandFlags()
    expect(flags['install']).toContain('--yes')
    expect(flags['install']).toContain('-y')
    expect(flags['install']).toContain('--dns-ip')
    expect(flags['install']).toContain('--domain')
  })
})

describe('getGlobalFlags', () => {
  test('includes version and help flags', () => {
    const flags = getGlobalFlags()
    expect(flags).toContain('-V')
    expect(flags).toContain('--version')
    expect(flags).toContain('-h')
    expect(flags).toContain('--help')
  })
})

describe('getCommandDescriptions', () => {
  test('returns descriptions for all commands', () => {
    const descs = getCommandDescriptions()
    const subcommands = getSubcommands()

    for (const cmd of subcommands) {
      expect(descs[cmd]).toBeDefined()
      expect(descs[cmd]!.length).toBeGreaterThan(0)
    }
  })

  test('aliases share the parent description', () => {
    const descs = getCommandDescriptions()
    expect(descs['ls']).toBe(descs['list'])
    expect(descs['rm']).toBe(descs['remove'])
    expect(descs['dc']).toBe(descs['compose'])
  })
})

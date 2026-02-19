import { describe, expect, test } from 'vitest'
import {
  posixShellQuote,
  fishShellQuote,
  shellQuote,
  shellCd,
  shellExport,
  shellUnset,
  buildEnterCommands,
  buildExitCommands,
  SUPPORTED_SHELLS,
  type Shell,
} from './shell.ts'

describe('posixShellQuote', () => {
  test('quotes a simple string', () => {
    expect(posixShellQuote('hello')).toBe("'hello'")
  })

  test('handles empty string', () => {
    expect(posixShellQuote('')).toBe("''")
  })

  test('handles spaces', () => {
    expect(posixShellQuote('/path/to/my project')).toBe("'/path/to/my project'")
  })

  test('escapes embedded single quotes', () => {
    expect(posixShellQuote("it's")).toBe("'it'\\''s'")
  })

  test('handles multiple single quotes', () => {
    expect(posixShellQuote("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''")
  })

  test('handles special characters without escaping them', () => {
    expect(posixShellQuote('$HOME/path')).toBe("'$HOME/path'")
  })

  test('handles backslashes', () => {
    expect(posixShellQuote('path\\to\\file')).toBe("'path\\to\\file'")
  })
})

describe('fishShellQuote', () => {
  test('quotes a simple string', () => {
    expect(fishShellQuote('hello')).toBe("'hello'")
  })

  test('handles empty string', () => {
    expect(fishShellQuote('')).toBe("''")
  })

  test('escapes embedded single quotes', () => {
    expect(fishShellQuote("it's")).toBe("'it\\'s'")
  })

  test('escapes backslashes', () => {
    expect(fishShellQuote('path\\to\\file')).toBe("'path\\\\to\\\\file'")
  })

  test('handles both backslashes and quotes', () => {
    expect(fishShellQuote("it's a \\path")).toBe("'it\\'s a \\\\path'")
  })
})

describe('shellQuote', () => {
  test('uses posix quoting for bash', () => {
    expect(shellQuote('bash', "it's")).toBe("'it'\\''s'")
  })

  test('uses posix quoting for zsh', () => {
    expect(shellQuote('zsh', "it's")).toBe("'it'\\''s'")
  })

  test('uses fish quoting for fish', () => {
    expect(shellQuote('fish', "it's")).toBe("'it\\'s'")
  })
})

describe('shellCd', () => {
  test('generates cd -- for bash', () => {
    expect(shellCd('bash', '/repo')).toBe("cd -- '/repo'")
  })

  test('generates cd -- for zsh', () => {
    expect(shellCd('zsh', '/repo')).toBe("cd -- '/repo'")
  })

  test('generates builtin cd for fish', () => {
    expect(shellCd('fish', '/repo')).toBe("builtin cd '/repo'")
  })

  test('handles paths with spaces', () => {
    expect(shellCd('bash', '/my repo/path')).toBe("cd -- '/my repo/path'")
  })

  test('handles paths with single quotes', () => {
    expect(shellCd('bash', "/O'Brien/repo")).toBe("cd -- '/O'\\''Brien/repo'")
  })
})

describe('shellExport', () => {
  test('generates export for bash', () => {
    expect(shellExport('bash', 'PORT_WORKTREE', 'feature-1')).toBe(
      "export PORT_WORKTREE='feature-1'"
    )
  })

  test('generates export for zsh', () => {
    expect(shellExport('zsh', 'PORT_WORKTREE', 'feature-1')).toBe(
      "export PORT_WORKTREE='feature-1'"
    )
  })

  test('generates set -gx for fish', () => {
    expect(shellExport('fish', 'PORT_WORKTREE', 'feature-1')).toBe(
      "set -gx PORT_WORKTREE 'feature-1'"
    )
  })

  test('handles values with special characters', () => {
    expect(shellExport('bash', 'PORT_REPO', '/path/to/my repo')).toBe(
      "export PORT_REPO='/path/to/my repo'"
    )
  })
})

describe('shellUnset', () => {
  test('generates unset for bash', () => {
    expect(shellUnset('bash', 'PORT_WORKTREE')).toBe('unset PORT_WORKTREE')
  })

  test('generates unset for zsh', () => {
    expect(shellUnset('zsh', 'PORT_WORKTREE')).toBe('unset PORT_WORKTREE')
  })

  test('generates set -e for fish', () => {
    expect(shellUnset('fish', 'PORT_WORKTREE')).toBe('set -e PORT_WORKTREE')
  })
})

describe('buildEnterCommands', () => {
  const shells: Shell[] = ['bash', 'zsh', 'fish']

  for (const shell of shells) {
    test(`generates correct commands for ${shell}`, () => {
      const result = buildEnterCommands(shell, '/repo/.port/trees/feature-1', 'feature-1', '/repo')
      const lines = result.split('\n')

      expect(lines).toHaveLength(3)

      // First line should be cd
      expect(lines[0]).toContain('/repo/.port/trees/feature-1')

      // Second line should export PORT_WORKTREE
      expect(lines[1]).toContain('PORT_WORKTREE')
      expect(lines[1]).toContain('feature-1')

      // Third line should export PORT_REPO
      expect(lines[2]).toContain('PORT_REPO')
      expect(lines[2]).toContain('/repo')
    })
  }

  test('bash output is syntactically correct', () => {
    const result = buildEnterCommands('bash', '/repo/.port/trees/feat', 'feat', '/repo')
    expect(result).toBe(
      [
        "cd -- '/repo/.port/trees/feat'",
        "export PORT_WORKTREE='feat'",
        "export PORT_REPO='/repo'",
      ].join('\n')
    )
  })

  test('fish output is syntactically correct', () => {
    const result = buildEnterCommands('fish', '/repo/.port/trees/feat', 'feat', '/repo')
    expect(result).toBe(
      [
        "builtin cd '/repo/.port/trees/feat'",
        "set -gx PORT_WORKTREE 'feat'",
        "set -gx PORT_REPO '/repo'",
      ].join('\n')
    )
  })
})

describe('buildExitCommands', () => {
  test('bash output is syntactically correct', () => {
    const result = buildExitCommands('bash', '/repo')
    expect(result).toBe(["cd -- '/repo'", 'unset PORT_WORKTREE', 'unset PORT_REPO'].join('\n'))
  })

  test('zsh output is syntactically correct', () => {
    const result = buildExitCommands('zsh', '/repo')
    expect(result).toBe(["cd -- '/repo'", 'unset PORT_WORKTREE', 'unset PORT_REPO'].join('\n'))
  })

  test('fish output is syntactically correct', () => {
    const result = buildExitCommands('fish', '/repo')
    expect(result).toBe(
      ["builtin cd '/repo'", 'set -e PORT_WORKTREE', 'set -e PORT_REPO'].join('\n')
    )
  })
})

describe('SUPPORTED_SHELLS', () => {
  test('contains bash, zsh, and fish', () => {
    expect(SUPPORTED_SHELLS).toEqual(['bash', 'zsh', 'fish'])
  })
})

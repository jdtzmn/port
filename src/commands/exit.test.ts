import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  writeEvalFile: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/shell.ts', async () => {
  const actual = await vi.importActual<typeof import('../lib/shell.ts')>('../lib/shell.ts')
  return {
    ...actual,
    writeEvalFile: mocks.writeEvalFile,
  }
})

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  error: mocks.error,
  info: mocks.info,
  dim: mocks.dim,
  newline: mocks.newline,
}))

import { exit } from './exit.ts'

describe('exit command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: in a worktree, not the main repo
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo/.port/trees/feature-1',
      name: 'feature-1',
      isMainRepo: false,
    })

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })

    // Clear eval env vars by default
    delete process.env.__PORT_EVAL
    delete process.env.__PORT_SHELL
    delete process.env.PORT_WORKTREE
    delete process.env.PORT_REPO
  })

  afterEach(() => {
    exitSpy.mockRestore()
    // Restore original env
    process.env = { ...originalEnv }
  })

  describe('with shell hook active (__PORT_EVAL set)', () => {
    beforeEach(() => {
      process.env.__PORT_EVAL = '/tmp/test-eval-file'
    })

    test('writes bash shell commands to eval file', async () => {
      process.env.__PORT_SHELL = 'bash'

      await exit()

      expect(mocks.writeEvalFile).toHaveBeenCalledTimes(1)
      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string
      const evalFile = mocks.writeEvalFile.mock.calls[0]![1] as string

      expect(evalFile).toBe('/tmp/test-eval-file')
      expect(commands).toContain("cd -- '/repo'")
      expect(commands).toContain('unset PORT_WORKTREE')
      expect(commands).toContain('unset PORT_REPO')
    })

    test('writes fish shell commands to eval file', async () => {
      process.env.__PORT_SHELL = 'fish'

      await exit()

      expect(mocks.writeEvalFile).toHaveBeenCalledTimes(1)
      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string

      expect(commands).toContain("builtin cd '/repo'")
      expect(commands).toContain('set -e PORT_WORKTREE')
      expect(commands).toContain('set -e PORT_REPO')
    })

    test('writes eval commands when PORT_WORKTREE is set', async () => {
      process.env.__PORT_SHELL = 'bash'
      process.env.PORT_WORKTREE = 'feature-1'

      // Even if git says we're in main repo, PORT_WORKTREE takes precedence
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo',
        name: 'repo',
        isMainRepo: true,
      })

      await exit()

      expect(mocks.writeEvalFile).toHaveBeenCalledTimes(1)
      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string
      expect(commands).toContain("cd -- '/repo'")
      expect(commands).toContain('unset PORT_WORKTREE')
    })

    test('does not write eval file when already at repo root', async () => {
      process.env.__PORT_SHELL = 'bash'

      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo',
        name: 'repo',
        isMainRepo: true,
      })

      await exit()

      expect(mocks.writeEvalFile).not.toHaveBeenCalled()
      expect(mocks.info).toHaveBeenCalledWith('Already at the repository root')
    })

    test('exits with error when not in a git repository', async () => {
      process.env.__PORT_SHELL = 'bash'

      mocks.detectWorktree.mockImplementation(() => {
        throw new Error('not a git repo')
      })

      await expect(exit()).rejects.toThrow('process.exit:1')

      expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('without shell hook (no __PORT_EVAL)', () => {
    test('prints cd hint when in a worktree', async () => {
      await exit()

      expect(mocks.info).toHaveBeenCalledWith('Run: cd /repo')
      expect(mocks.writeEvalFile).not.toHaveBeenCalled()
    })

    test('prints shell integration hint when in a worktree', async () => {
      await exit()

      expect(mocks.dim).toHaveBeenCalledWith(expect.stringContaining('port shell-hook'))
    })

    test('prints cd hint when PORT_WORKTREE is set', async () => {
      process.env.PORT_WORKTREE = 'feature-1'
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo',
        name: 'repo',
        isMainRepo: true,
      })

      await exit()

      expect(mocks.info).toHaveBeenCalledWith('Run: cd /repo')
    })

    test('informs user when already at repository root', async () => {
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo',
        name: 'repo',
        isMainRepo: true,
      })

      await exit()

      expect(mocks.info).toHaveBeenCalledWith('Already at the repository root')
      expect(mocks.writeEvalFile).not.toHaveBeenCalled()
    })

    test('exits with error when not in a git repository', async () => {
      mocks.detectWorktree.mockImplementation(() => {
        throw new Error('not a git repo')
      })

      await expect(exit()).rejects.toThrow('process.exit:1')

      expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('shell command output format', () => {
    beforeEach(() => {
      process.env.__PORT_EVAL = '/tmp/test-eval-file'
    })

    test('bash commands are separated by newlines', async () => {
      process.env.__PORT_SHELL = 'bash'

      await exit()

      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string
      const lines = commands.trim().split('\n')

      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe("cd -- '/repo'")
      expect(lines[1]).toBe('unset PORT_WORKTREE')
      expect(lines[2]).toBe('unset PORT_REPO')
    })

    test('fish commands are separated by newlines', async () => {
      process.env.__PORT_SHELL = 'fish'

      await exit()

      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string
      const lines = commands.trim().split('\n')

      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe("builtin cd '/repo'")
      expect(lines[1]).toBe('set -e PORT_WORKTREE')
      expect(lines[2]).toBe('set -e PORT_REPO')
    })

    test('handles repo root paths with spaces', async () => {
      process.env.__PORT_SHELL = 'bash'

      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/my repo/path',
        worktreePath: '/my repo/path/.port/trees/feature-1',
        name: 'feature-1',
        isMainRepo: false,
      })

      await exit()

      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string
      expect(commands).toContain("cd -- '/my repo/path'")
    })

    test('handles repo root paths with single quotes (bash)', async () => {
      process.env.__PORT_SHELL = 'bash'

      mocks.detectWorktree.mockReturnValue({
        repoRoot: "/O'Brien/repo",
        worktreePath: "/O'Brien/repo/.port/trees/feature-1",
        name: 'feature-1',
        isMainRepo: false,
      })

      await exit()

      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string
      expect(commands).toContain("cd -- '/O'\\''Brien/repo'")
    })

    test('handles repo root paths with single quotes (fish)', async () => {
      process.env.__PORT_SHELL = 'fish'

      mocks.detectWorktree.mockReturnValue({
        repoRoot: "/O'Brien/repo",
        worktreePath: "/O'Brien/repo/.port/trees/feature-1",
        name: 'feature-1',
        isMainRepo: false,
      })

      await exit()

      const commands = mocks.writeEvalFile.mock.calls[0]![0] as string
      expect(commands).toContain("builtin cd '/O\\'Brien/repo'")
    })
  })
})

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

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
  let stdoutSpy: ReturnType<typeof vi.spyOn>
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

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    // Clear PORT_WORKTREE by default
    delete process.env.PORT_WORKTREE
    delete process.env.PORT_REPO
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
    // Restore original env
    process.env = { ...originalEnv }
  })

  describe('with --shell-helper', () => {
    test('outputs shell commands when in a worktree (detected by git)', async () => {
      await exit({ shellHelper: true })

      expect(stdoutSpy).toHaveBeenCalledTimes(1)
      const output = stdoutSpy.mock.calls[0][0] as string

      expect(output).toContain("cd -- '/repo'")
      expect(output).toContain('unset PORT_WORKTREE')
      expect(output).toContain('unset PORT_REPO')
    })

    test('outputs shell commands when PORT_WORKTREE is set', async () => {
      process.env.PORT_WORKTREE = 'feature-1'

      // Even if git says we're in main repo, PORT_WORKTREE takes precedence
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo',
        name: 'repo',
        isMainRepo: true,
      })

      await exit({ shellHelper: true })

      expect(stdoutSpy).toHaveBeenCalledTimes(1)
      const output = stdoutSpy.mock.calls[0][0] as string

      expect(output).toContain("cd -- '/repo'")
      expect(output).toContain('unset PORT_WORKTREE')
      expect(output).toContain('unset PORT_REPO')
    })

    test('does not output shell commands when at repo root', async () => {
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo',
        name: 'repo',
        isMainRepo: true,
      })

      await exit({ shellHelper: true })

      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(mocks.info).toHaveBeenCalledWith('Already at the repository root')
    })

    test('exits with error when not in a git repository', async () => {
      mocks.detectWorktree.mockImplementation(() => {
        throw new Error('not a git repo')
      })

      await expect(exit({ shellHelper: true })).rejects.toThrow('process.exit:1')

      expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('without --shell-helper', () => {
    test('prints cd hint when in a worktree', async () => {
      await exit()

      expect(mocks.info).toHaveBeenCalledWith('Run: cd /repo')
      expect(stdoutSpy).not.toHaveBeenCalled()
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
      expect(stdoutSpy).not.toHaveBeenCalled()
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
    test('outputs commands separated by newlines', async () => {
      await exit({ shellHelper: true })

      const output = stdoutSpy.mock.calls[0][0] as string
      const lines = output.trim().split('\n')

      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe("cd -- '/repo'")
      expect(lines[1]).toBe('unset PORT_WORKTREE')
      expect(lines[2]).toBe('unset PORT_REPO')
    })

    test('handles repo root paths with spaces', async () => {
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/my repo/path',
        worktreePath: '/my repo/path/.port/trees/feature-1',
        name: 'feature-1',
        isMainRepo: false,
      })

      await exit({ shellHelper: true })

      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("cd -- '/my repo/path'")
    })

    test('handles repo root paths with single quotes', async () => {
      mocks.detectWorktree.mockReturnValue({
        repoRoot: "/O'Brien/repo",
        worktreePath: "/O'Brien/repo/.port/trees/feature-1",
        name: 'feature-1',
        isMainRepo: false,
      })

      await exit({ shellHelper: true })

      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("cd -- '/O'\\''Brien/repo'")
    })
  })
})

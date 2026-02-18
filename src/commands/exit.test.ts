import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  error: mocks.error,
  info: mocks.info,
  dim: mocks.dim,
}))

import { exit } from './exit.ts'

describe('exit command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let consoleSpy: ReturnType<typeof vi.spyOn>
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

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Clear PORT_WORKTREE by default
    delete process.env.PORT_WORKTREE
    delete process.env.PORT_REPO
  })

  afterEach(() => {
    exitSpy.mockRestore()
    consoleSpy.mockRestore()
    // Restore original env
    process.env = { ...originalEnv }
  })

  test('exits the sub-shell when PORT_WORKTREE is set', async () => {
    process.env.PORT_WORKTREE = 'feature-1'

    await expect(exit()).rejects.toThrow('process.exit:0')

    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(mocks.dim).toHaveBeenCalledWith('Leaving worktree: feature-1')
  })

  test('prints cd command when in a worktree but not a sub-shell', async () => {
    await exit()

    expect(consoleSpy).toHaveBeenCalledWith('cd /repo')
    expect(exitSpy).not.toHaveBeenCalled()
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
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('cd '))
    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('exits with error when not in a git repository', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    await expect(exit()).rejects.toThrow('process.exit:1')

    expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('prioritizes sub-shell exit over worktree detection', async () => {
    // Even if detectWorktree says we're in the main repo,
    // if PORT_WORKTREE is set we should exit the sub-shell
    process.env.PORT_WORKTREE = 'feature-1'
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'repo',
      isMainRepo: true,
    })

    await expect(exit()).rejects.toThrow('process.exit:0')

    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(mocks.dim).toHaveBeenCalledWith('Leaving worktree: feature-1')
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  hookExists: vi.fn(),
  runHook: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  command: vi.fn((s: string) => s),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/hooks.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/hooks.ts')>()
  return {
    ...actual,
    hookExists: mocks.hookExists,
    runHook: mocks.runHook,
  }
})

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  newline: mocks.newline,
  info: mocks.info,
  dim: mocks.dim,
  success: mocks.success,
  error: mocks.error,
  command: mocks.command,
}))

import { hook } from './hook.ts'

describe('hook command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo/.port/trees/my-branch',
      name: 'my-branch',
      isMainRepo: false,
    })
    mocks.hookExists.mockResolvedValue(true)
    mocks.runHook.mockResolvedValue({ success: true, exitCode: 0 })
  })

  // -----------------------------------------------------------------------
  // Worktree detection
  // -----------------------------------------------------------------------

  test('throws CliError when not in a git repository', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not in git')
    })

    await expect(hook('post-create', {})).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
  })

  // -----------------------------------------------------------------------
  // --list flag
  // -----------------------------------------------------------------------

  test('--list shows configured hooks', async () => {
    mocks.hookExists.mockResolvedValue(true)

    await hook(undefined, { list: true })

    expect(mocks.header).toHaveBeenCalledWith('Available hooks:')
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('post-create'))
    expect(mocks.dim).not.toHaveBeenCalled()
  })

  test('--list shows unconfigured hooks', async () => {
    mocks.hookExists.mockResolvedValue(false)

    await hook(undefined, { list: true })

    expect(mocks.header).toHaveBeenCalledWith('Available hooks:')
    expect(mocks.dim).toHaveBeenCalledWith(expect.stringContaining('post-create'))
    expect(mocks.dim).toHaveBeenCalledWith(expect.stringContaining('not configured'))
  })

  test('--list works from main repo (no worktree check)', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'main',
      isMainRepo: true,
    })
    mocks.hookExists.mockResolvedValue(true)

    await hook(undefined, { list: true })

    expect(mocks.header).toHaveBeenCalledWith('Available hooks:')
  })

  // -----------------------------------------------------------------------
  // Missing hook name
  // -----------------------------------------------------------------------

  test('throws CliError when no hook name is provided', async () => {
    await expect(hook(undefined, {})).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Missing hook name')
    // Should also show available hooks
    expect(mocks.header).toHaveBeenCalledWith('Available hooks:')
  })

  // -----------------------------------------------------------------------
  // Invalid hook name
  // -----------------------------------------------------------------------

  test('throws CliError for unknown hook name', async () => {
    await expect(hook('invalid-hook', {})).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Unknown hook "invalid-hook"')
    // Should also show available hooks
    expect(mocks.header).toHaveBeenCalledWith('Available hooks:')
  })

  // -----------------------------------------------------------------------
  // Must be in a worktree
  // -----------------------------------------------------------------------

  test('throws CliError when run from main repo', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'main',
      isMainRepo: true,
    })

    await expect(hook('post-create', {})).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith(
      'Must be inside a worktree to run hooks. Use `port enter <branch>` first.'
    )
  })

  // -----------------------------------------------------------------------
  // Hook script not found
  // -----------------------------------------------------------------------

  test('throws CliError when hook script does not exist', async () => {
    mocks.hookExists.mockResolvedValue(false)

    await expect(hook('post-create', {})).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith(
      'Hook "post-create" is not configured. Create an executable script at .port/hooks/post-create.sh'
    )
  })

  // -----------------------------------------------------------------------
  // Successful hook execution
  // -----------------------------------------------------------------------

  test('runs hook and reports success', async () => {
    await hook('post-create', {})

    expect(mocks.info).toHaveBeenCalledWith('Running post-create hook...')
    expect(mocks.runHook).toHaveBeenCalledWith(
      '/repo',
      'post-create',
      {
        PORT_ROOT_PATH: '/repo',
        PORT_WORKTREE_PATH: '/repo/.port/trees/my-branch',
        PORT_BRANCH: 'my-branch',
      },
      'my-branch'
    )
    expect(mocks.success).toHaveBeenCalledWith('Hook "post-create" completed')
  })

  // -----------------------------------------------------------------------
  // Failed hook execution
  // -----------------------------------------------------------------------

  test('throws CliError when hook fails with non-zero exit code', async () => {
    mocks.runHook.mockResolvedValue({ success: false, exitCode: 2 })

    await expect(hook('post-create', {})).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Hook "post-create" failed (exit code 2)')
    expect(mocks.dim).toHaveBeenCalledWith('See .port/logs/latest.log for details')
  })

  test('CliError from failed hook carries the hook exit code', async () => {
    mocks.runHook.mockResolvedValue({ success: false, exitCode: 42 })

    try {
      await hook('post-create', {})
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).exitCode).toBe(42)
      expect((err as CliError).alreadyReported).toBe(true)
    }
  })
})

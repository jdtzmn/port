import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  getRegistrationLockPath: vi.fn(),
  loadConfig: vi.fn(),
  getCurrentBranch: vi.fn(),
  isProjectRegistered: vi.fn(),
  hookExists: vi.fn(),
  runPostCreateHook: vi.fn(),
  registerProject: vi.fn(),
  withFileLock: vi.fn(),
}))

vi.mock('./worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('./config.ts', () => ({
  configExists: mocks.configExists,
  getRegistrationLockPath: mocks.getRegistrationLockPath,
  loadConfig: mocks.loadConfig,
}))

vi.mock('./git.ts', () => ({
  getCurrentBranch: mocks.getCurrentBranch,
}))

vi.mock('./registry.ts', () => ({
  isProjectRegistered: mocks.isProjectRegistered,
  registerProject: mocks.registerProject,
}))

vi.mock('./hooks.ts', () => ({
  hookExists: mocks.hookExists,
  runPostCreateHook: mocks.runPostCreateHook,
}))

vi.mock('./state.ts', () => ({
  withFileLock: mocks.withFileLock,
}))

import { ensureCurrentWorktreeRegistered, markWorktreeRegistered } from './worktreeRegistration.ts'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.configExists.mockReturnValue(true)
  mocks.loadConfig.mockResolvedValue({ domain: 'custom.test' })
  mocks.detectWorktree.mockReturnValue({
    repoRoot: '/repo',
    worktreePath: '/repo/.port/trees/feature-worktree',
    name: 'feature-worktree',
    isMainRepo: false,
  })
  mocks.getCurrentBranch.mockResolvedValue('feature/new')
  mocks.getRegistrationLockPath.mockReturnValue('/repo/.port/registration-feature-new.lock')
  mocks.withFileLock.mockImplementation((_lockPath, callback) => callback())
  mocks.isProjectRegistered.mockResolvedValue(false)
  mocks.hookExists.mockResolvedValue(false)
  mocks.runPostCreateHook.mockResolvedValue({ success: true, exitCode: 0 })
  mocks.registerProject.mockResolvedValue(undefined)
})

describe('ensureCurrentWorktreeRegistered', () => {
  test('does nothing outside a git repository', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('Not in a git repository')
    })

    await ensureCurrentWorktreeRegistered()

    expect(mocks.configExists).not.toHaveBeenCalled()
    expect(mocks.registerProject).not.toHaveBeenCalled()
  })

  test('registers an unmanaged worktree with empty ports', async () => {
    await ensureCurrentWorktreeRegistered()

    expect(mocks.registerProject).toHaveBeenCalledWith('/repo', 'feature-new', [])
  })
  test('passes the configured domain to the post-create hook', async () => {
    mocks.hookExists.mockResolvedValue(true)

    await ensureCurrentWorktreeRegistered()

    expect(mocks.runPostCreateHook).toHaveBeenCalledWith({
      repoRoot: '/repo',
      worktreePath: '/repo/.port/trees/feature-worktree',
      branch: 'feature-new',
      domain: 'custom.test',
    })
  })

  test('fails when the post-create hook fails', async () => {
    mocks.hookExists.mockResolvedValue(true)
    mocks.runPostCreateHook.mockResolvedValue({ success: false, exitCode: 2 })

    await expect(ensureCurrentWorktreeRegistered()).rejects.toThrow(
      'Post-create hook failed (exit code 2)'
    )

    expect(mocks.registerProject).not.toHaveBeenCalled()
  })

  test('skips worktrees that are already registered', async () => {
    mocks.isProjectRegistered.mockResolvedValue(true)

    await ensureCurrentWorktreeRegistered()

    expect(mocks.hookExists).not.toHaveBeenCalled()
    expect(mocks.registerProject).not.toHaveBeenCalled()
  })

  test('serializes the check-hook-register sequence behind a per repo+branch lock', async () => {
    await ensureCurrentWorktreeRegistered()

    expect(mocks.getRegistrationLockPath).toHaveBeenCalledWith('/repo', 'feature-new')
    expect(mocks.withFileLock).toHaveBeenCalledWith(
      '/repo/.port/registration-feature-new.lock',
      expect.any(Function)
    )
  })

  test('does not register when the lock is held by another in-flight port command', async () => {
    mocks.withFileLock.mockImplementation(() => {
      // Simulate another `port` command currently holding the lock: this
      // call never runs the guarded callback, so isProjectRegistered/
      // hookExists/registerProject must not be invoked either.
      return Promise.resolve()
    })

    await ensureCurrentWorktreeRegistered()

    expect(mocks.isProjectRegistered).not.toHaveBeenCalled()
    expect(mocks.hookExists).not.toHaveBeenCalled()
    expect(mocks.registerProject).not.toHaveBeenCalled()
  })
})

describe('markWorktreeRegistered', () => {
  test('registers the worktree inside the same per repo+branch lock', async () => {
    await markWorktreeRegistered('/repo', 'feature-new')

    expect(mocks.getRegistrationLockPath).toHaveBeenCalledWith('/repo', 'feature-new')
    expect(mocks.withFileLock).toHaveBeenCalledWith(
      '/repo/.port/registration-feature-new.lock',
      expect.any(Function)
    )
    expect(mocks.registerProject).toHaveBeenCalledWith('/repo', 'feature-new', [])
  })

  test('swallows failures so a broken lock never blocks the calling command', async () => {
    mocks.withFileLock.mockRejectedValue(new Error('lock timed out'))

    await expect(markWorktreeRegistered('/repo', 'feature-new')).resolves.toBeUndefined()
  })
})

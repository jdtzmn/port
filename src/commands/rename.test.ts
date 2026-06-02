import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  ensurePortRuntimeDir: vi.fn(),
  loadConfigOrDefault: vi.fn(),
  getComposeFile: vi.fn(),
  worktreeExists: vi.fn(),
  getWorktreePath: vi.fn(),
  renameWorktree: vi.fn(),
  getCurrentBranch: vi.fn(),
  branchExists: vi.fn(),
  branchHasRunningServices: vi.fn(),
  rewriteRegistryForRename: vi.fn(),
  rewriteHostServicesForRename: vi.fn(),
  parseComposeFile: vi.fn(),
  writeOverrideFile: vi.fn(),
  getProjectName: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
  branch: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
  worktreeExists: mocks.worktreeExists,
  getWorktreePath: mocks.getWorktreePath,
}))

vi.mock('../lib/config.ts', () => ({
  ensurePortRuntimeDir: mocks.ensurePortRuntimeDir,
  loadConfigOrDefault: mocks.loadConfigOrDefault,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/git.ts', () => ({
  getCurrentBranch: mocks.getCurrentBranch,
  branchExists: mocks.branchExists,
  renameWorktree: mocks.renameWorktree,
}))

vi.mock('../lib/registry.ts', () => ({
  rewriteRegistryForRename: mocks.rewriteRegistryForRename,
  branchHasRunningServices: mocks.branchHasRunningServices,
  rewriteHostServicesForRename: mocks.rewriteHostServicesForRename,
}))

vi.mock('../lib/compose.ts', () => ({
  parseComposeFile: mocks.parseComposeFile,
  writeOverrideFile: mocks.writeOverrideFile,
  getProjectName: mocks.getProjectName,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  warn: mocks.warn,
  error: mocks.error,
  info: mocks.info,
  dim: mocks.dim,
  newline: mocks.newline,
  branch: mocks.branch,
}))

import { rename } from './rename.ts'

describe('rename command', () => {
  const originalArgv = process.argv
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo/.port/trees/feature-old',
      name: 'feature-old',
      isMainRepo: false,
    })
    mocks.ensurePortRuntimeDir.mockResolvedValue(undefined)
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.worktreeExists.mockReturnValue(true)
    mocks.worktreeExists.mockReturnValueOnce(false)
    mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/feature-new')
    mocks.getCurrentBranch.mockResolvedValue('feature-old')
    mocks.branchExists.mockResolvedValue(false)
    mocks.branchHasRunningServices.mockResolvedValue(false)
    mocks.renameWorktree.mockResolvedValue('/repo/.port/trees/feature-new')
    mocks.rewriteRegistryForRename.mockResolvedValue(undefined)
    mocks.rewriteHostServicesForRename.mockResolvedValue(undefined)
    mocks.parseComposeFile.mockResolvedValue({ name: 'repo', services: {} })
    mocks.writeOverrideFile.mockResolvedValue(undefined)
    mocks.getProjectName.mockReturnValue('repo-feature-new')
    mocks.branch.mockImplementation((value: string) => value)

    process.argv = ['/usr/local/bin/bun', '/repo/dist/index.js', 'rename', 'feature-new']

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })
  })

  afterEach(() => {
    process.argv = originalArgv
    exitSpy.mockRestore()
  })

  test('refuses to rename when running services are detected', async () => {
    mocks.branchHasRunningServices.mockResolvedValue(true)

    await expect(rename('feature-new')).rejects.toThrow(
      'Stop running services before renaming this worktree.'
    )

    expect(mocks.info).toHaveBeenCalledWith('Checking for running services...')
    expect(mocks.error).toHaveBeenCalledWith('Stop running services before renaming this worktree.')
    expect(mocks.renameWorktree).not.toHaveBeenCalled()
  })

  test('renames the current worktree and refreshes Port state', async () => {
    await rename('feature-new')

    expect(mocks.renameWorktree).toHaveBeenCalledWith('/repo', 'feature-old', 'feature-new')
    expect(mocks.rewriteRegistryForRename).toHaveBeenCalledWith(
      '/repo',
      'feature-old',
      'feature-new'
    )
    expect(mocks.rewriteHostServicesForRename).toHaveBeenCalledWith(
      '/repo',
      'feature-old',
      'feature-new'
    )
    expect(mocks.writeOverrideFile).toHaveBeenCalledWith(
      '/repo/.port/trees/feature-new',
      expect.any(Object),
      'feature-new',
      'port',
      'repo-feature-new'
    )
    expect(mocks.success).toHaveBeenCalledWith('Renamed worktree feature-old → feature-new')
  })
})

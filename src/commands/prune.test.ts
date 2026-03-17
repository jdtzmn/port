import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  detectWorktree: vi.fn(),
  ensurePortRuntimeDir: vi.fn(),
  loadConfigOrDefault: vi.fn(),
  getComposeFile: vi.fn(),
  getDefaultBranch: vi.fn(),
  getMergedBranches: vi.fn(),
  getGoneBranches: vi.fn(),
  fetchAndPrune: vi.fn(),
  listWorktrees: vi.fn(),
  isGhAvailable: vi.fn(),
  getMergedPrBranches: vi.fn(),
  removeWorktreeAndCleanup: vi.fn(),
  sanitizeBranchName: vi.fn(),
  failWithError: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  newline: vi.fn(),
  header: vi.fn(),
  dim: vi.fn(),
  branch: vi.fn(),
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
  },
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  ensurePortRuntimeDir: mocks.ensurePortRuntimeDir,
  loadConfigOrDefault: mocks.loadConfigOrDefault,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/git.ts', () => ({
  getDefaultBranch: mocks.getDefaultBranch,
  getMergedBranches: mocks.getMergedBranches,
  getGoneBranches: mocks.getGoneBranches,
  fetchAndPrune: mocks.fetchAndPrune,
  listWorktrees: mocks.listWorktrees,
}))

vi.mock('../lib/github.ts', () => ({
  isGhAvailable: mocks.isGhAvailable,
  getMergedPrBranches: mocks.getMergedPrBranches,
}))

vi.mock('../lib/removal.ts', () => ({
  removeWorktreeAndCleanup: mocks.removeWorktreeAndCleanup,
}))

vi.mock('../lib/sanitize.ts', () => ({
  sanitizeBranchName: mocks.sanitizeBranchName,
}))

vi.mock('../lib/cli.ts', () => ({
  failWithError: mocks.failWithError,
}))

vi.mock('../lib/output.ts', () => ({
  info: mocks.info,
  success: mocks.success,
  warn: mocks.warn,
  newline: mocks.newline,
  header: mocks.header,
  dim: mocks.dim,
  branch: mocks.branch,
}))

import { prune } from './prune.ts'

describe('prune command', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.ensurePortRuntimeDir.mockResolvedValue(undefined)
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')

    mocks.fetchAndPrune.mockResolvedValue(undefined)
    mocks.getDefaultBranch.mockResolvedValue('main')
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/repo/.port/trees/feature-a', branch: 'feature-a', isMain: false },
    ])
    mocks.getMergedBranches.mockResolvedValue(['feature-a'])
    mocks.getGoneBranches.mockResolvedValue([])

    mocks.isGhAvailable.mockResolvedValue(false)
    mocks.getMergedPrBranches.mockResolvedValue(new Map())

    mocks.removeWorktreeAndCleanup.mockResolvedValue({ success: true })
    mocks.sanitizeBranchName.mockImplementation((name: string) => name)
    mocks.branch.mockImplementation((name: string) => name)
  })

  test('supports dry-run mode without removing worktrees', async () => {
    await prune({ dryRun: true })

    expect(mocks.ensurePortRuntimeDir).toHaveBeenCalledWith('/repo')
    expect(mocks.fetchAndPrune).toHaveBeenCalledWith('/repo')
    expect(mocks.removeWorktreeAndCleanup).not.toHaveBeenCalled()
    expect(mocks.dim).toHaveBeenCalledWith(
      'Dry run — no changes made. Re-run without --dry-run to remove.'
    )
  })

  test('removes candidates with --force using default config values', async () => {
    await prune({ force: true })

    expect(mocks.loadConfigOrDefault).toHaveBeenCalledWith('/repo')
    expect(mocks.getComposeFile).toHaveBeenCalledWith({
      domain: 'port',
      compose: 'docker-compose.yml',
    })
    expect(mocks.removeWorktreeAndCleanup).toHaveBeenCalledWith(
      {
        repoRoot: '/repo',
        composeFile: 'docker-compose.yml',
        domain: 'port',
      },
      'feature-a',
      expect.objectContaining({
        branchAction: 'archive',
        quiet: true,
      })
    )
  })

  test('reports clean state when no candidates are found', async () => {
    mocks.getMergedBranches.mockResolvedValue([])

    await prune({ force: true })

    expect(mocks.success).toHaveBeenCalledWith('No merged worktrees found. Everything is clean.')
    expect(mocks.removeWorktreeAndCleanup).not.toHaveBeenCalled()
  })
})

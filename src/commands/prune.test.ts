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
  cleanupDockerResources: vi.fn(),
  scanDockerResourcesForProject: vi.fn(),
  getProjectName: vi.fn(),
  stopWorktreeServices: vi.fn(),
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
  stopWorktreeServices: mocks.stopWorktreeServices,
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

vi.mock('../lib/docker-cleanup.ts', () => ({
  cleanupDockerResources: mocks.cleanupDockerResources,
  scanDockerResourcesForProject: mocks.scanDockerResourcesForProject,
}))

vi.mock('../lib/compose.ts', () => ({
  getProjectName: mocks.getProjectName,
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

    mocks.getProjectName.mockImplementation((_repoRoot: string, branch: string) => `port-${branch}`)
    mocks.stopWorktreeServices.mockResolvedValue(undefined)
    mocks.cleanupDockerResources.mockResolvedValue({
      volumesRemoved: 0,
      networksRemoved: 0,
      containersRemoved: 0,
      imagesRemoved: 0,
      totalRemoved: 0,
      warnings: [],
      dockerAvailable: true,
    })
    mocks.scanDockerResourcesForProject.mockResolvedValue({
      projectName: 'port-feature-a',
      volumes: [],
      networks: [],
      containers: [],
      images: [],
      imageSize: undefined,
    })
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

  describe('docker cleanup integration', () => {
    test('runs low-risk cleanup by default for each pruned worktree', async () => {
      mocks.cleanupDockerResources.mockResolvedValue({
        volumesRemoved: 2,
        networksRemoved: 1,
        containersRemoved: 3,
        imagesRemoved: 0,
        totalRemoved: 6,
        warnings: [],
        dockerAvailable: true,
      })

      await prune({ force: true })

      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-feature-a', {
        skipImages: true,
        quiet: false,
      })
    })

    test('displays non-fatal warnings from docker cleanup', async () => {
      mocks.cleanupDockerResources.mockResolvedValue({
        volumesRemoved: 1,
        networksRemoved: 0,
        containersRemoved: 0,
        imagesRemoved: 0,
        totalRemoved: 1,
        warnings: ['Failed to remove volume xyz: in use'],
        dockerAvailable: true,
      })

      await prune({ force: true })

      expect(mocks.warn).toHaveBeenCalledWith('Failed to remove volume xyz: in use')
    })

    test('prompts for batch image cleanup with aggregate estimate', async () => {
      mocks.listWorktrees.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.port/trees/feature-a', branch: 'feature-a', isMain: false },
        { path: '/repo/.port/trees/feature-b', branch: 'feature-b', isMain: false },
      ])
      mocks.getMergedBranches.mockResolvedValue(['feature-a', 'feature-b'])

      mocks.scanDockerResourcesForProject
        .mockResolvedValueOnce({
          projectName: 'port-feature-a',
          volumes: [],
          networks: [],
          containers: [],
          images: [{ id: 'img1', name: 'app:v1' }],
          imageSize: 50 * 1024 * 1024, // 50 MB
        })
        .mockResolvedValueOnce({
          projectName: 'port-feature-b',
          volumes: [],
          networks: [],
          containers: [],
          images: [
            { id: 'img2', name: 'app:v2' },
            { id: 'img3', name: 'app:v3' },
          ],
          imageSize: 100 * 1024 * 1024, // 100 MB
        })

      mocks.prompt.mockResolvedValue({ confirmPrune: true, cleanupImages: false })

      await prune({})

      // Should show aggregate stats
      expect(mocks.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'cleanupImages',
          message: 'Clean up 3 image(s) across 2 projects (150.0 MB)?',
          default: false,
        }),
      ])
    })

    test('skips image prompt when no images found', async () => {
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-feature-a',
        volumes: [],
        networks: [],
        containers: [],
        images: [],
        imageSize: undefined,
      })

      mocks.prompt.mockResolvedValue({ confirmPrune: true })

      await prune({})

      // Should only prompt once for prune confirmation, not for images
      expect(mocks.prompt).toHaveBeenCalledTimes(1)
      expect(mocks.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'confirmPrune',
        }),
      ])
    })

    test('runs image-only cleanup when confirmed', async () => {
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-feature-a',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'app:v1' }],
        imageSize: 50 * 1024 * 1024,
      })

      mocks.cleanupDockerResources
        .mockResolvedValueOnce({
          volumesRemoved: 1,
          networksRemoved: 1,
          containersRemoved: 1,
          imagesRemoved: 0,
          totalRemoved: 3,
          warnings: [],
          dockerAvailable: true,
        })
        .mockResolvedValueOnce({
          volumesRemoved: 0,
          networksRemoved: 0,
          containersRemoved: 0,
          imagesRemoved: 1,
          totalRemoved: 1,
          warnings: [],
          dockerAvailable: true,
        })

      mocks.prompt.mockResolvedValue({ confirmPrune: true, cleanupImages: true })

      await prune({})

      // Should call cleanup twice: once for low-risk, once for images-only
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-feature-a', {
        skipImages: true,
        quiet: false,
      })
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-feature-a', {
        imagesOnly: true,
        quiet: false,
      })
    })

    test('shows "declined" message when image cleanup is declined interactively', async () => {
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-feature-a',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'app:v1' }],
        imageSize: 50 * 1024 * 1024,
      })

      mocks.prompt.mockResolvedValue({ confirmPrune: true, cleanupImages: false })

      await prune({})

      expect(mocks.info).toHaveBeenCalledWith('Image cleanup declined')
    })

    test('handles unknown size fallback in aggregate estimate', async () => {
      mocks.listWorktrees.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.port/trees/feature-a', branch: 'feature-a', isMain: false },
        { path: '/repo/.port/trees/feature-b', branch: 'feature-b', isMain: false },
      ])
      mocks.getMergedBranches.mockResolvedValue(['feature-a', 'feature-b'])

      mocks.scanDockerResourcesForProject
        .mockResolvedValueOnce({
          projectName: 'port-feature-a',
          volumes: [],
          networks: [],
          containers: [],
          images: [{ id: 'img1', name: 'app:v1' }],
          imageSize: undefined, // Unknown
        })
        .mockResolvedValueOnce({
          projectName: 'port-feature-b',
          volumes: [],
          networks: [],
          containers: [],
          images: [{ id: 'img2', name: 'app:v2' }],
          imageSize: 50 * 1024 * 1024,
        })

      mocks.prompt.mockResolvedValue({ confirmPrune: true, cleanupImages: false })

      await prune({})

      // Should show "unknown size" when any size is undefined
      expect(mocks.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'cleanupImages',
          message: 'Clean up 2 image(s) across 2 projects (unknown size)?',
          default: false,
        }),
      ])
    })

    test('non-interactive mode skips image cleanup by default', async () => {
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-feature-a',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'app:v1' }],
        imageSize: 50 * 1024 * 1024,
      })

      await prune({ force: true })

      // Should only cleanup low-risk resources, not images
      expect(mocks.cleanupDockerResources).toHaveBeenCalledTimes(1)
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-feature-a', {
        skipImages: true,
        quiet: false,
      })
      expect(mocks.info).not.toHaveBeenCalledWith('Image cleanup declined')
    })

    test('non-interactive mode with --cleanup-images flag cleans up images', async () => {
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-feature-a',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'app:v1' }],
        imageSize: 50 * 1024 * 1024,
      })

      mocks.cleanupDockerResources
        .mockResolvedValueOnce({
          volumesRemoved: 1,
          networksRemoved: 1,
          containersRemoved: 1,
          imagesRemoved: 0,
          totalRemoved: 3,
          warnings: [],
          dockerAvailable: true,
        })
        .mockResolvedValueOnce({
          volumesRemoved: 0,
          networksRemoved: 0,
          containersRemoved: 0,
          imagesRemoved: 1,
          totalRemoved: 1,
          warnings: [],
          dockerAvailable: true,
        })

      await prune({ force: true, cleanupImages: true })

      // Should cleanup both low-risk and images
      expect(mocks.cleanupDockerResources).toHaveBeenCalledTimes(2)
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-feature-a', {
        imagesOnly: true,
        quiet: false,
      })
    })
  })
})

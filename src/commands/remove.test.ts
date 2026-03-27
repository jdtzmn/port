import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  detectWorktree: vi.fn(),
  worktreeExists: vi.fn(),
  getWorktreePath: vi.fn(),
  ensurePortRuntimeDir: vi.fn(),
  loadConfigOrDefault: vi.fn(),
  getComposeFile: vi.fn(),
  findWorktreeByBranch: vi.fn(),
  archiveBranch: vi.fn(),
  removeWorktree: vi.fn(),
  removeWorktreeAtPath: vi.fn(),
  pruneWorktrees: vi.fn(),
  unregisterProject: vi.fn(),
  hasRegisteredProjects: vi.fn(),
  runCompose: vi.fn(),
  stopTraefik: vi.fn(),
  isTraefikRunning: vi.fn(),
  getProjectName: vi.fn(),
  existsSync: vi.fn(),
  exit: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
  branch: vi.fn(),
  cleanupDockerResources: vi.fn(),
  scanDockerResourcesForProject: vi.fn(),
  getImagesSizeInBytes: vi.fn(),
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
  },
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
  findWorktreeByBranch: mocks.findWorktreeByBranch,
  archiveBranch: mocks.archiveBranch,
  removeWorktree: mocks.removeWorktree,
  removeWorktreeAtPath: mocks.removeWorktreeAtPath,
  pruneWorktrees: mocks.pruneWorktrees,
}))

vi.mock('../lib/registry.ts', () => ({
  unregisterProject: mocks.unregisterProject,
  hasRegisteredProjects: mocks.hasRegisteredProjects,
}))

vi.mock('../lib/compose.ts', () => ({
  runCompose: mocks.runCompose,
  stopTraefik: mocks.stopTraefik,
  isTraefikRunning: mocks.isTraefikRunning,
  getProjectName: mocks.getProjectName,
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
}))

vi.mock('./exit.ts', () => ({
  exit: mocks.exit,
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

vi.mock('../lib/docker-cleanup.ts', () => ({
  cleanupDockerResources: mocks.cleanupDockerResources,
  scanDockerResourcesForProject: mocks.scanDockerResourcesForProject,
  getImagesSizeInBytes: mocks.getImagesSizeInBytes,
}))

import { remove } from './remove.ts'

describe('remove command', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PORT_WORKTREE

    mocks.exit.mockResolvedValue(undefined)
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'repo',
      isMainRepo: true,
    })
    mocks.worktreeExists.mockReturnValue(true)
    mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/demo-2')

    mocks.ensurePortRuntimeDir.mockResolvedValue(undefined)
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')

    mocks.findWorktreeByBranch.mockResolvedValue(null)
    mocks.archiveBranch.mockResolvedValue('archive/demo-2-20260206T120000Z')
    mocks.removeWorktree.mockResolvedValue(undefined)
    mocks.removeWorktreeAtPath.mockResolvedValue(undefined)
    mocks.pruneWorktrees.mockResolvedValue(undefined)

    mocks.unregisterProject.mockResolvedValue(undefined)
    mocks.hasRegisteredProjects.mockResolvedValue(false)

    mocks.runCompose.mockResolvedValue({ exitCode: 0 })
    mocks.stopTraefik.mockResolvedValue(undefined)
    mocks.isTraefikRunning.mockResolvedValue(false)
    mocks.getProjectName.mockReturnValue('repo-demo-2')

    mocks.existsSync.mockReturnValue(true)
    mocks.branch.mockImplementation((name: string) => name)

    // Default docker cleanup mocks
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
      projectName: 'repo-demo-2',
      volumes: [],
      networks: [],
      containers: [],
      images: [],
      imageSize: undefined,
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('removes a standard worktree path', async () => {
    await remove('demo-2')

    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
    expect(mocks.archiveBranch).toHaveBeenCalledWith('/repo', 'demo-2')
    expect(mocks.removeWorktreeAtPath).not.toHaveBeenCalled()
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  test('prompts before removing non-standard worktree path', async () => {
    const nestedPath = '/repo/.port/trees/demo-1/.port/trees/demo-2'
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue({
      path: nestedPath,
      branch: 'demo-2',
      isMain: false,
    })
    mocks.prompt.mockResolvedValue({ removeConfirm: true })

    await remove('demo-2')

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({ message: 'Remove this worktree anyway?' }),
    ])
    expect(mocks.runCompose).toHaveBeenCalledWith(
      nestedPath,
      'docker-compose.yml',
      'repo-demo-2',
      ['down'],
      {
        repoRoot: '/repo',
        branch: 'demo-2',
        domain: 'port',
      }
    )
    expect(mocks.removeWorktreeAtPath).toHaveBeenCalledWith('/repo', nestedPath, true)
    expect(mocks.archiveBranch).toHaveBeenCalledWith('/repo', 'demo-2')
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('skips prompt for non-standard path when --force is set', async () => {
    const nestedPath = '/repo/.port/trees/demo-1/.port/trees/demo-2'
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue({
      path: nestedPath,
      branch: 'demo-2',
      isMain: false,
    })

    await remove('demo-2', { force: true })

    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.removeWorktreeAtPath).toHaveBeenCalledWith('/repo', nestedPath, true)
  })

  test('keeps branch when --keep-branch is set', async () => {
    await remove('demo-2', { keepBranch: true })

    expect(mocks.archiveBranch).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })

  test('prunes stale worktree metadata when path is missing', async () => {
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue({
      path: '/repo/.port/trees/demo-2',
      branch: 'demo-2',
      isMain: false,
    })
    mocks.existsSync.mockReturnValue(false)

    await remove('demo-2', { force: true })

    expect(mocks.runCompose).not.toHaveBeenCalled()
    expect(mocks.pruneWorktrees).toHaveBeenCalledWith('/repo')
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.removeWorktreeAtPath).not.toHaveBeenCalled()
  })

  test('throws a CLI error when not in a git repository', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    await expect(remove('demo-2')).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
  })

  test('throws a CLI error when worktree is missing', async () => {
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue(null)

    await expect(remove('demo-2')).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Worktree not found: demo-2')
  })

  test('exits worktree before removing when user is inside it', async () => {
    process.env.PORT_WORKTREE = 'demo-2'

    await remove('demo-2')

    expect(mocks.exit).toHaveBeenCalled()
    // Verify exit was called before worktree removal
    const exitOrder = mocks.exit.mock.invocationCallOrder[0]!
    const removeOrder = mocks.removeWorktree.mock.invocationCallOrder[0]!
    expect(exitOrder).toBeLessThan(removeOrder)

    // Verify the rest of the removal still completes
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })

  test('does not exit when user is not inside the target worktree', async () => {
    delete process.env.PORT_WORKTREE

    await remove('demo-2')

    expect(mocks.exit).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })

  test('exits worktree before removing when git-detected inside it (no PORT_WORKTREE)', async () => {
    delete process.env.PORT_WORKTREE
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo/.port/trees/demo-2',
      name: 'demo-2',
      isMainRepo: false,
    })

    await remove('demo-2')

    expect(mocks.exit).toHaveBeenCalled()
    const exitOrder = mocks.exit.mock.invocationCallOrder[0]!
    const removeOrder = mocks.removeWorktree.mock.invocationCallOrder[0]!
    expect(exitOrder).toBeLessThan(removeOrder)
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })

  test('does not exit when git-detected inside a different worktree', async () => {
    delete process.env.PORT_WORKTREE
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo/.port/trees/other-branch',
      name: 'other-branch',
      isMainRepo: false,
    })

    await remove('demo-2')

    expect(mocks.exit).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })

  describe('auto-detect from current worktree', () => {
    test('detects branch from current worktree when no branch given', async () => {
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo/.port/trees/feature-1',
        name: 'feature-1',
        isMainRepo: false,
      })
      mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/feature-1')
      mocks.prompt.mockResolvedValue({ confirmRemove: true })

      await remove(undefined)

      expect(mocks.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'confirmRemove',
          message: expect.stringContaining('feature-1'),
          default: false,
        }),
      ])
      expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'feature-1', true)
    })

    test('uses PORT_WORKTREE env var when at repo root', async () => {
      process.env.PORT_WORKTREE = 'feature-2'
      mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/feature-2')
      mocks.prompt.mockResolvedValue({ confirmRemove: true })

      await remove(undefined)

      expect(mocks.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'confirmRemove',
          message: expect.stringContaining('feature-2'),
        }),
      ])
      expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'feature-2', true)
    })

    test('fails when no branch and not in a worktree', async () => {
      delete process.env.PORT_WORKTREE

      await expect(remove(undefined)).rejects.toBeInstanceOf(CliError)
      expect(mocks.error).toHaveBeenCalledWith('No branch specified and not inside a worktree')
    })

    test('cancels when user declines confirmation', async () => {
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo/.port/trees/feature-1',
        name: 'feature-1',
        isMainRepo: false,
      })
      mocks.prompt.mockResolvedValue({ confirmRemove: false })

      await remove(undefined)

      expect(mocks.info).toHaveBeenCalledWith('Removal cancelled')
      expect(mocks.removeWorktree).not.toHaveBeenCalled()
      expect(mocks.runCompose).not.toHaveBeenCalled()
    })

    test('skips confirmation with --force', async () => {
      mocks.detectWorktree.mockReturnValue({
        repoRoot: '/repo',
        worktreePath: '/repo/.port/trees/feature-1',
        name: 'feature-1',
        isMainRepo: false,
      })
      mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/feature-1')

      await remove(undefined, { force: true })

      expect(mocks.prompt).not.toHaveBeenCalled()
      expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'feature-1', true)
    })

    test('does not prompt for confirmation when branch is explicitly provided', async () => {
      await remove('demo-2')

      expect(mocks.prompt).not.toHaveBeenCalled()
      expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
    })
  })

  describe('docker cleanup integration', () => {
    beforeEach(() => {
      // Default: successful low-risk cleanup
      mocks.cleanupDockerResources.mockResolvedValue({
        volumesRemoved: 2,
        networksRemoved: 1,
        containersRemoved: 1,
        imagesRemoved: 0,
        totalRemoved: 4,
        warnings: [],
        dockerAvailable: true,
      })
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'repo-demo-2',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'app:latest' }],
        imageSize: 1024 * 1024 * 50, // 50 MB
      })
    })

    test('runs low-risk cleanup (containers/networks/volumes) by default', async () => {
      await remove('demo-2')

      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('repo-demo-2', {
        skipImages: true,
        quiet: false,
      })
      expect(mocks.info).toHaveBeenCalledWith('Cleaning up Docker resources...')
      expect(mocks.success).toHaveBeenCalledWith(
        'Cleaned up 4 resource(s): 1 container(s), 2 volume(s), 1 network(s)'
      )
    })

    test('prompts for image cleanup when images exist (interactive mode)', async () => {
      mocks.prompt.mockResolvedValue({ cleanupImages: true })

      await remove('demo-2')

      // First cleanup without images
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('repo-demo-2', {
        skipImages: true,
        quiet: false,
      })

      // Then scan for images
      expect(mocks.scanDockerResourcesForProject).toHaveBeenCalledWith('repo-demo-2')

      // Then prompt
      const promptCall = mocks.prompt.mock.calls.find((call: any[]) =>
        call[0]?.some((q: any) => q.name === 'cleanupImages')
      )
      expect(promptCall).toBeDefined()
      const imagePrompt = promptCall![0].find((q: any) => q.name === 'cleanupImages')
      expect(imagePrompt.message).toContain('1 image(s)')
      expect(imagePrompt.message).toContain('50.0 MB')
      expect(imagePrompt.default).toBe(false)
    })

    test('image cleanup prompt defaults to No', async () => {
      mocks.prompt.mockResolvedValue({ cleanupImages: false })

      await remove('demo-2')

      expect(mocks.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          default: false,
        }),
      ])
      expect(mocks.info).toHaveBeenCalledWith('Image cleanup declined')
    })

    test('executes image cleanup when user confirms', async () => {
      mocks.prompt.mockResolvedValue({ cleanupImages: true })
      mocks.cleanupDockerResources
        .mockResolvedValueOnce({
          // First call: low-risk
          volumesRemoved: 2,
          networksRemoved: 1,
          containersRemoved: 1,
          imagesRemoved: 0,
          totalRemoved: 4,
          warnings: [],
          dockerAvailable: true,
        })
        .mockResolvedValueOnce({
          // Second call: images
          volumesRemoved: 0,
          networksRemoved: 0,
          containersRemoved: 0,
          imagesRemoved: 1,
          totalRemoved: 1,
          warnings: [],
          dockerAvailable: true,
        })

      await remove('demo-2')

      expect(mocks.cleanupDockerResources).toHaveBeenCalledTimes(2)
      expect(mocks.cleanupDockerResources).toHaveBeenNthCalledWith(2, 'repo-demo-2', {
        skipImages: false,
        quiet: false,
      })
      expect(mocks.success).toHaveBeenCalledWith('Cleaned up 1 image(s)')
    })

    test('shows "unknown" when image size cannot be determined', async () => {
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'repo-demo-2',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'app:latest' }],
        imageSize: undefined, // Size unavailable
      })
      mocks.prompt.mockResolvedValue({ cleanupImages: false })

      await remove('demo-2')

      expect(mocks.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          message: expect.stringContaining('unknown size'),
        }),
      ])
    })

    test('skips image prompt when no images exist', async () => {
      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'repo-demo-2',
        volumes: [],
        networks: [],
        containers: [],
        images: [], // No images
        imageSize: undefined,
      })

      await remove('demo-2')

      // Should only have one prompt call (if any auto-detect prompts)
      const cleanupImagesCalls = mocks.prompt.mock.calls.filter((call: any[]) =>
        call[0]?.some((q: any) => q.name === 'cleanupImages')
      )
      expect(cleanupImagesCalls.length).toBe(0)
    })

    test('treats docker cleanup failures as non-fatal', async () => {
      mocks.cleanupDockerResources.mockResolvedValue({
        volumesRemoved: 0,
        networksRemoved: 0,
        containersRemoved: 0,
        imagesRemoved: 0,
        totalRemoved: 0,
        warnings: ['Docker daemon not available - skipping cleanup'],
        dockerAvailable: false,
      })

      await remove('demo-2')

      expect(mocks.warn).toHaveBeenCalledWith('Docker daemon not available - skipping cleanup')
      expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('removed')) // Worktree removal still succeeds
    })

    test('displays cleanup warnings but continues', async () => {
      mocks.cleanupDockerResources.mockResolvedValue({
        volumesRemoved: 1,
        networksRemoved: 0,
        containersRemoved: 0,
        imagesRemoved: 0,
        totalRemoved: 1,
        warnings: ['Failed to remove volume vol1: permission denied'],
        dockerAvailable: true,
      })

      await remove('demo-2')

      expect(mocks.warn).toHaveBeenCalledWith('Failed to remove volume vol1: permission denied')
      expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('1 resource(s)'))
    })

    test('supports --cleanup-images flag to skip prompt', async () => {
      mocks.cleanupDockerResources
        .mockResolvedValueOnce({
          // First call: low-risk
          volumesRemoved: 2,
          networksRemoved: 1,
          containersRemoved: 1,
          imagesRemoved: 0,
          totalRemoved: 4,
          warnings: [],
          dockerAvailable: true,
        })
        .mockResolvedValueOnce({
          // Second call: images
          volumesRemoved: 0,
          networksRemoved: 0,
          containersRemoved: 0,
          imagesRemoved: 1,
          totalRemoved: 1,
          warnings: [],
          dockerAvailable: true,
        })

      await remove('demo-2', { cleanupImages: true })

      // Should NOT prompt
      const cleanupImagesCalls = mocks.prompt.mock.calls.filter((call: any[]) =>
        call[0]?.some((q: any) => q.name === 'cleanupImages')
      )
      expect(cleanupImagesCalls.length).toBe(0)

      // Should cleanup images directly
      expect(mocks.cleanupDockerResources).toHaveBeenNthCalledWith(2, 'repo-demo-2', {
        skipImages: false,
        quiet: false,
      })
    })
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  detectWorktree: vi.fn(),
  listArchivedBranches: vi.fn(),
  deleteLocalBranch: vi.fn(),
  getProjectName: vi.fn(),
  cleanupDockerResources: vi.fn(),
  scanDockerResourcesForProject: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  branch: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
  },
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/git.ts', () => ({
  listArchivedBranches: mocks.listArchivedBranches,
  deleteLocalBranch: mocks.deleteLocalBranch,
}))

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  newline: mocks.newline,
  branch: mocks.branch,
  info: mocks.info,
  success: mocks.success,
  warn: mocks.warn,
  error: mocks.error,
}))

vi.mock('../lib/compose.ts', () => ({
  getProjectName: mocks.getProjectName,
}))

vi.mock('../lib/docker-cleanup.ts', () => ({
  cleanupDockerResources: mocks.cleanupDockerResources,
  scanDockerResourcesForProject: mocks.scanDockerResourcesForProject,
}))

import { cleanup } from './cleanup.ts'

// Helper type for cleanup options
type CleanupOptions = Parameters<typeof cleanup>[0]

describe('cleanup command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.listArchivedBranches.mockResolvedValue([])
    mocks.branch.mockImplementation((name: string) => name)
    mocks.getProjectName.mockImplementation((repoRoot: string, branch: string) => `port-${branch}`)
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
      projectName: 'port-test',
      volumes: [],
      networks: [],
      containers: [],
      images: [],
      volumeSize: undefined,
      imageSize: undefined,
    })
  })

  test('throws a CLI error when not in a git repository', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not in git')
    })

    await expect(cleanup()).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
  })

  test('shows info and exits when there are no archived branches', async () => {
    await cleanup()

    expect(mocks.info).toHaveBeenCalledWith('No archived branches to clean up.')
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  test('cancels when confirmation is declined', async () => {
    mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
    mocks.prompt.mockResolvedValue({ confirmCleanup: false })

    await cleanup()

    expect(mocks.info).toHaveBeenCalledWith('Cleanup cancelled')
    expect(mocks.deleteLocalBranch).not.toHaveBeenCalled()
  })

  test('deletes all archived branches when confirmed', async () => {
    mocks.listArchivedBranches.mockResolvedValue([
      'archive/demo-20260206T120000Z',
      'archive/test-20260206T130000Z',
    ])
    mocks.prompt.mockResolvedValue({ confirmCleanup: true })

    await cleanup()

    expect(mocks.deleteLocalBranch).toHaveBeenCalledTimes(2)
    expect(mocks.deleteLocalBranch).toHaveBeenCalledWith(
      '/repo',
      'archive/demo-20260206T120000Z',
      true
    )
    expect(mocks.deleteLocalBranch).toHaveBeenCalledWith(
      '/repo',
      'archive/test-20260206T130000Z',
      true
    )
    expect(mocks.success).toHaveBeenCalledWith('Deleted 2 archived branch(es).')
  })

  test('throws a CLI error when any branch deletion fails', async () => {
    mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
    mocks.prompt.mockResolvedValue({ confirmCleanup: true })
    mocks.deleteLocalBranch.mockRejectedValue(new Error('delete failed'))

    await expect(cleanup()).rejects.toBeInstanceOf(CliError)
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete archive/demo-20260206T120000Z')
    )
  })

  describe('docker cleanup integration', () => {
    test('runs low-risk cleanup for each archived branch', async () => {
      mocks.listArchivedBranches.mockResolvedValue([
        'archive/demo-20260206T120000Z',
        'archive/test-20260206T130000Z',
      ])
      mocks.prompt.mockResolvedValue({ confirmCleanup: true })
      mocks.deleteLocalBranch.mockResolvedValue(undefined)

      await cleanup()

      // Should cleanup for each archived branch (extracting sanitized name from archive/name-timestamp)
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-demo', {
        skipImages: true,
        quiet: false,
      })
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-test', {
        skipImages: true,
        quiet: false,
      })
    })

    test('displays low-risk cleanup results when resources are removed', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.prompt.mockResolvedValue({ confirmCleanup: true })
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.cleanupDockerResources.mockResolvedValueOnce({
        volumesRemoved: 2,
        networksRemoved: 1,
        containersRemoved: 3,
        imagesRemoved: 0,
        totalRemoved: 6,
        warnings: [],
        dockerAvailable: true,
      })

      await cleanup()

      expect(mocks.success).toHaveBeenCalledWith(
        expect.stringContaining(
          'Cleaned up 6 resource(s): 3 container(s), 2 volume(s), 1 network(s)'
        )
      )
    })

    test('displays warnings from cleanup non-fatally', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.prompt.mockResolvedValue({ confirmCleanup: true })
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.cleanupDockerResources.mockResolvedValueOnce({
        volumesRemoved: 0,
        networksRemoved: 0,
        containersRemoved: 0,
        imagesRemoved: 0,
        totalRemoved: 0,
        warnings: ['Docker daemon not available - skipping cleanup'],
        dockerAvailable: false,
      })

      await cleanup()

      expect(mocks.warn).toHaveBeenCalledWith('Docker daemon not available - skipping cleanup')
      // Should not throw - warnings are non-fatal
      expect(mocks.success).toHaveBeenCalledWith('Deleted 1 archived branch(es).')
    })

    test('scans for images after low-risk cleanup', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.prompt.mockResolvedValue({ confirmCleanup: true })
      mocks.deleteLocalBranch.mockResolvedValue(undefined)

      await cleanup()

      expect(mocks.scanDockerResourcesForProject).toHaveBeenCalledWith('port-demo')
    })

    test('prompts for image cleanup when images exist with default No', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.prompt
        .mockResolvedValueOnce({ confirmCleanup: true })
        .mockResolvedValueOnce({ cleanupImages: false })

      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-demo',
        volumes: [],
        networks: [],
        containers: [],
        images: [
          { id: 'img1', name: 'test:latest' },
          { id: 'img2', name: 'app:dev' },
        ],
        imageSize: 104857600, // 100 MB
      })

      await cleanup()

      expect(mocks.prompt).toHaveBeenCalledWith([
        {
          type: 'confirm',
          name: 'cleanupImages',
          message: 'Clean up 2 image(s) (100.0 MB)?',
          default: false,
        },
      ])
      expect(mocks.info).toHaveBeenCalledWith('Image cleanup declined')
    })

    test('cleans up images when user confirms', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.prompt
        .mockResolvedValueOnce({ confirmCleanup: true })
        .mockResolvedValueOnce({ cleanupImages: true })

      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-demo',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'test:latest' }],
        imageSize: 52428800, // 50 MB
      })

      mocks.cleanupDockerResources.mockResolvedValueOnce({
        volumesRemoved: 0,
        networksRemoved: 0,
        containersRemoved: 0,
        imagesRemoved: 0,
        totalRemoved: 0,
        warnings: [],
        dockerAvailable: true,
      })

      mocks.cleanupDockerResources.mockResolvedValueOnce({
        volumesRemoved: 0,
        networksRemoved: 0,
        containersRemoved: 0,
        imagesRemoved: 1,
        totalRemoved: 1,
        warnings: [],
        dockerAvailable: true,
      })

      await cleanup()

      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-demo', {
        imagesOnly: true,
        quiet: false,
      })
      expect(mocks.success).toHaveBeenCalledWith('Cleaned up 1 image(s)')
    })

    test('shows unknown size when image size unavailable', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.prompt
        .mockResolvedValueOnce({ confirmCleanup: true })
        .mockResolvedValueOnce({ cleanupImages: false })

      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-demo',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'test:latest' }],
        imageSize: undefined,
      })

      await cleanup()

      expect(mocks.prompt).toHaveBeenCalledWith([
        {
          type: 'confirm',
          name: 'cleanupImages',
          message: 'Clean up 1 image(s) (unknown size)?',
          default: false,
        },
      ])
    })

    test('aggregates images across multiple archived branches', async () => {
      mocks.listArchivedBranches.mockResolvedValue([
        'archive/demo-20260206T120000Z',
        'archive/test-20260206T130000Z',
      ])
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.prompt
        .mockResolvedValueOnce({ confirmCleanup: true })
        .mockResolvedValueOnce({ cleanupImages: true })

      mocks.scanDockerResourcesForProject
        .mockResolvedValueOnce({
          projectName: 'port-demo',
          volumes: [],
          networks: [],
          containers: [],
          images: [{ id: 'img1', name: 'test:latest' }],
          imageSize: 52428800, // 50 MB
        })
        .mockResolvedValueOnce({
          projectName: 'port-test',
          volumes: [],
          networks: [],
          containers: [],
          images: [
            { id: 'img2', name: 'app:dev' },
            { id: 'img3', name: 'db:latest' },
          ],
          imageSize: 104857600, // 100 MB
        })

      await cleanup()

      expect(mocks.prompt).toHaveBeenCalledWith([
        {
          type: 'confirm',
          name: 'cleanupImages',
          message: 'Clean up 3 image(s) across 2 projects (150.0 MB)?',
          default: false,
        },
      ])
    })

    test('skips image prompt when --cleanup-images flag is provided', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.prompt.mockResolvedValueOnce({ confirmCleanup: true })

      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-demo',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'test:latest' }],
        imageSize: 52428800,
      })

      mocks.cleanupDockerResources
        .mockResolvedValueOnce({
          volumesRemoved: 0,
          networksRemoved: 0,
          containersRemoved: 0,
          imagesRemoved: 0,
          totalRemoved: 0,
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

      const opts: CleanupOptions = { cleanupImages: true }
      await cleanup(opts)

      // Should not prompt for image cleanup (only for branch deletion)
      expect(mocks.prompt).toHaveBeenCalledTimes(1)
      expect(mocks.cleanupDockerResources).toHaveBeenCalledWith('port-demo', {
        imagesOnly: true,
        quiet: false,
      })
    })

    test('skips images without prompt when --cleanup-images=false', async () => {
      mocks.listArchivedBranches.mockResolvedValue(['archive/demo-20260206T120000Z'])
      mocks.deleteLocalBranch.mockResolvedValue(undefined)
      mocks.prompt.mockResolvedValueOnce({ confirmCleanup: true })

      mocks.scanDockerResourcesForProject.mockResolvedValue({
        projectName: 'port-demo',
        volumes: [],
        networks: [],
        containers: [],
        images: [{ id: 'img1', name: 'test:latest' }],
        imageSize: 52428800,
      })

      const opts: CleanupOptions = { cleanupImages: false }
      await cleanup(opts)

      // Should not prompt for image cleanup
      expect(mocks.prompt).toHaveBeenCalledTimes(1)
      // Should not call image cleanup
      expect(mocks.cleanupDockerResources).toHaveBeenCalledTimes(1) // Only low-risk cleanup
      expect(mocks.info).not.toHaveBeenCalledWith('Image cleanup declined')
    })
  })
})

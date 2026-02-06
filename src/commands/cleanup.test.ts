import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  detectWorktree: vi.fn(),
  listArchivedBranches: vi.fn(),
  deleteLocalBranch: vi.fn(),
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

import { cleanup } from './cleanup.ts'

describe('cleanup command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.listArchivedBranches.mockResolvedValue([])
    mocks.branch.mockImplementation((name: string) => name)
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
})

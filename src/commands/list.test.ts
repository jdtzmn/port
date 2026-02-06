import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  configExists: mocks.configExists,
  loadConfig: vi.fn(),
  getComposeFile: vi.fn(),
  getTreesDir: vi.fn(),
}))

vi.mock('../lib/output.ts', () => ({
  error: mocks.error,
  branch: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  success: vi.fn(),
  dim: vi.fn(),
  url: vi.fn(),
}))

import { list } from './list.ts'

describe('list command errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('throws CliError when outside git repository', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not in git')
    })

    await expect(list()).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
  })

  test('throws CliError when config is missing', async () => {
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.configExists.mockReturnValue(false)

    await expect(list()).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Port not initialized. Run "port init" first.')
  })
})

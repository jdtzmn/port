import { beforeEach, describe, expect, test, vi } from 'vitest'

const rawMock = vi.hoisted(() => vi.fn())

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    raw: rawMock,
  })),
}))

vi.mock('./worktree.ts', () => ({
  getWorktreePath: vi.fn((repoRoot: string, branch: string) => `${repoRoot}/.port/trees/${branch}`),
}))

import {
  isValidBranchRef,
  parseDuplicateWorktreeError,
  renameWorktree,
  resolveBranchRef,
} from './git.ts'

beforeEach(() => {
  rawMock.mockReset()
})

describe('parseDuplicateWorktreeError', () => {
  test('extracts branch and path from duplicate-worktree output', () => {
    const error = new Error(
      "fatal: 'feature-1' is already used by worktree at '/repo/.port/trees/feature-1'"
    )

    expect(parseDuplicateWorktreeError(error)).toEqual({
      branch: 'feature-1',
      path: '/repo/.port/trees/feature-1',
    })
  })

  test('returns null for unrelated failures', () => {
    expect(parseDuplicateWorktreeError(new Error('fatal: unrelated failure'))).toBeNull()
  })
})

describe('renameWorktree', () => {
  test('moves the worktree path and renames the branch ref', async () => {
    await renameWorktree('/repo', 'feature-old', 'feature-new')

    expect(rawMock).toHaveBeenNthCalledWith(1, ['branch', '-m', 'feature-old', 'feature-new'])
    expect(rawMock).toHaveBeenNthCalledWith(2, [
      'worktree',
      'move',
      '/repo/.port/trees/feature-old',
      '/repo/.port/trees/feature-new',
    ])
  })
})

describe('isValidBranchRef', () => {
  test('returns true when git check-ref-format accepts the name', async () => {
    rawMock.mockResolvedValueOnce('feature/auth\n')

    await expect(isValidBranchRef('/repo', 'feature/auth')).resolves.toBe(true)
    expect(rawMock).toHaveBeenCalledWith(['check-ref-format', '--branch', 'feature/auth'])
  })

  test('returns false when git check-ref-format rejects the name', async () => {
    rawMock.mockRejectedValueOnce(new Error("fatal: 'my feature' is not a valid branch name"))

    await expect(isValidBranchRef('/repo', 'my feature')).resolves.toBe(false)
  })
})

describe('resolveBranchRef', () => {
  test('preserves a valid ref unchanged (slashes kept)', async () => {
    rawMock.mockResolvedValueOnce('feature/auth\n')

    await expect(resolveBranchRef('/repo', 'feature/auth')).resolves.toBe('feature/auth')
  })

  test('falls back to the sanitized name when the raw name is not a valid ref', async () => {
    rawMock.mockRejectedValueOnce(new Error("fatal: 'my feature' is not a valid branch name"))

    await expect(resolveBranchRef('/repo', 'my feature')).resolves.toBe('my-feature')
  })

  test('returns a simple valid name unchanged', async () => {
    rawMock.mockResolvedValueOnce('simple\n')

    await expect(resolveBranchRef('/repo', 'simple')).resolves.toBe('simple')
  })
})

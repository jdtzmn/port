import { describe, expect, test, vi } from 'vitest'

const rawMock = vi.hoisted(() => vi.fn())

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    raw: rawMock,
  })),
}))

vi.mock('./worktree.ts', () => ({
  getWorktreePath: vi.fn((repoRoot: string, branch: string) => `${repoRoot}/.port/trees/${branch}`),
}))

import { parseDuplicateWorktreeError, renameWorktree } from './git.ts'

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

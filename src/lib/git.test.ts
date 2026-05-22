import { describe, expect, test } from 'vitest'
import { parseDuplicateWorktreeError } from './git.ts'

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

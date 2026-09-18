import { beforeEach, describe, expect, test, vi } from 'vitest'

const rawMock = vi.hoisted(() => vi.fn())
const branchLocalMock = vi.hoisted(() => vi.fn())

const writeFileMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())
const unlinkMock = vi.hoisted(() => vi.fn())
vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    raw: rawMock,
    branchLocal: branchLocalMock,
  })),
}))

vi.mock('fs/promises', () => ({
  readFile: readFileMock,
  unlink: unlinkMock,
  writeFile: writeFileMock,
}))

vi.mock('./worktree.ts', () => ({
  getWorktreePath: vi.fn((repoRoot: string, branch: string) => `${repoRoot}/.port/trees/${branch}`),
}))

import {
  attemptSpeculativeWorktree,
  convertSpeculativeWorktree,
  recoverSpeculativeWorktree,
  createWorktree,
  isValidBranchRef,
  parseDuplicateWorktreeError,
  renameWorktree,
  resolveBranchRef,
} from './git.ts'

beforeEach(() => {
  rawMock.mockReset()
  writeFileMock.mockReset().mockResolvedValue(undefined)
  readFileMock.mockReset().mockRejectedValue(new Error('missing'))
  unlinkMock.mockReset().mockResolvedValue(undefined)
  branchLocalMock.mockReset()
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

describe('speculative worktrees', () => {
  const token = {
    path: '/repo/.port/trees/feature',
    ref: 'feature',
    expectedHead: 'speculative-head',
    gitDir: '/repo/.git/worktrees/feature',
  }

  test('captures ownership metadata after creating a speculative worktree', async () => {
    rawMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('speculative-head\n')
      .mockResolvedValueOnce('/repo/.git/worktrees/feature\n')

    await expect(attemptSpeculativeWorktree('/repo', 'feature', 'feature')).resolves.toEqual(token)

    expect(rawMock).toHaveBeenNthCalledWith(1, [
      'worktree',
      'add',
      '-b',
      'feature',
      '/repo/.port/trees/feature',
    ])
  })

  test('converts an owned clean worktree to track the remote branch in place', async () => {
    rawMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('speculative-head\n')
      .mockResolvedValueOnce('/repo/.git/worktrees/feature\n')
      .mockResolvedValueOnce('feature\n')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    await expect(convertSpeculativeWorktree('/repo', token)).resolves.toBe(token.path)

    expect(rawMock).toHaveBeenNthCalledWith(6, [
      '-C',
      token.path,
      'reset',
      '--keep',
      'origin/feature',
    ])
    expect(rawMock).toHaveBeenNthCalledWith(7, [
      'branch',
      '--set-upstream-to=origin/feature',
      'feature',
    ])
  })

  test('refuses to convert a dirty speculative worktree', async () => {
    rawMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('speculative-head\n')
      .mockResolvedValueOnce('/repo/.git/worktrees/feature\n')
      .mockResolvedValueOnce('feature\n')
      .mockResolvedValueOnce('?? changed.txt\n')

    await expect(convertSpeculativeWorktree('/repo', token)).rejects.toThrow(
      'Speculative worktree is no longer clean'
    )
    expect(rawMock).toHaveBeenCalledTimes(5)
  })

  test('refuses to convert a worktree whose HEAD changed after speculation', async () => {
    rawMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('different-head\n')
      .mockResolvedValueOnce('/repo/.git/worktrees/feature\n')
      .mockResolvedValueOnce('feature\n')
      .mockResolvedValueOnce('')

    await expect(convertSpeculativeWorktree('/repo', token)).rejects.toThrow(
      'Speculative worktree HEAD changed before remote conversion'
    )
    expect(rawMock).toHaveBeenCalledTimes(5)
  })

  test('ignores an empty speculative marker after successful cleanup', async () => {
    rawMock.mockResolvedValueOnce('')

    await expect(recoverSpeculativeWorktree('/repo', 'feature')).resolves.toBeNull()
  })
})
describe('createWorktree', () => {
  test('uses a caller-provided preflight without repeating branch checks', async () => {
    rawMock.mockResolvedValue(undefined)

    await expect(
      createWorktree('/repo', 'my feature', {
        ref: 'my-feature',
        localExists: true,
        remoteExists: false,
      })
    ).resolves.toBe('/repo/.port/trees/my feature')

    expect(rawMock).toHaveBeenCalledTimes(1)
    expect(rawMock).toHaveBeenCalledWith([
      'worktree',
      'add',
      '/repo/.port/trees/my feature',
      'my-feature',
    ])
  })

  test('refreshes a stale caller preflight after worktree creation fails', async () => {
    rawMock
      .mockRejectedValueOnce(new Error('stale preflight'))
      .mockRejectedValueOnce(new Error('invalid ref'))
      .mockResolvedValueOnce(undefined)
    branchLocalMock.mockResolvedValue({ all: ['my-feature'] })

    await expect(
      createWorktree('/repo', 'my feature', {
        ref: 'my-feature',
        localExists: true,
        remoteExists: false,
      })
    ).resolves.toBe('/repo/.port/trees/my feature')

    expect(rawMock).toHaveBeenNthCalledWith(1, [
      'worktree',
      'add',
      '/repo/.port/trees/my feature',
      'my-feature',
    ])
    expect(rawMock).toHaveBeenNthCalledWith(3, [
      'worktree',
      'add',
      '/repo/.port/trees/my feature',
      'my-feature',
    ])
  })

  test('does not retry discovery when remote branch fetching fails', async () => {
    rawMock.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('authentication failed'))

    await expect(
      createWorktree('/repo', 'feature', {
        ref: 'feature',
        localExists: false,
        remoteExists: true,
      })
    ).rejects.toThrow(
      "Failed to create worktree for 'feature': GitError: Failed to fetch 'feature'"
    )

    expect(rawMock).toHaveBeenCalledTimes(2)
    expect(rawMock).toHaveBeenNthCalledWith(1, [
      'rev-parse',
      '--verify',
      '--quiet',
      'refs/remotes/origin/feature',
    ])
    expect(rawMock).toHaveBeenNthCalledWith(2, [
      'fetch',
      'origin',
      '+refs/heads/feature:refs/remotes/origin/feature',
    ])
  })
})

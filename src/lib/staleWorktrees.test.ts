import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDefaultBranch: vi.fn(),
  getMergedBranches: vi.fn(),
  getGoneBranches: vi.fn(),
  listWorktrees: vi.fn(),
  isGhAvailable: vi.fn(),
  getMergedPrBranches: vi.fn(),
}))

vi.mock('./git.ts', () => ({
  getDefaultBranch: mocks.getDefaultBranch,
  getMergedBranches: mocks.getMergedBranches,
  getGoneBranches: mocks.getGoneBranches,
  listWorktrees: mocks.listWorktrees,
}))

vi.mock('./github.ts', () => ({
  isGhAvailable: mocks.isGhAvailable,
  getMergedPrBranches: mocks.getMergedPrBranches,
}))

import { getStaleWorktreeCandidates } from './staleWorktrees.ts'

describe('getStaleWorktreeCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getDefaultBranch.mockResolvedValue('main')
    mocks.getMergedBranches.mockResolvedValue([])
    mocks.getGoneBranches.mockResolvedValue([])
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/repo/.port/trees/feature-a', branch: 'feature-a', isMain: false },
      { path: '/repo/.port/trees/feature-b', branch: 'feature-b', isMain: false },
      { path: '/repo/.port/trees/feature-c', branch: 'feature-c', isMain: false },
    ])
    mocks.isGhAvailable.mockResolvedValue(true)
    mocks.getMergedPrBranches.mockResolvedValue(new Map())
  })

  test('returns merged, gone, and merged PR worktrees that exist locally', async () => {
    mocks.getMergedBranches.mockResolvedValue(['feature-a'])
    mocks.getGoneBranches.mockResolvedValue(['feature-b'])
    mocks.getMergedPrBranches.mockResolvedValue(
      new Map([
        [
          'feature-c',
          {
            number: 42,
            headRefName: 'feature-c',
            mergedAt: '2026-01-01T00:00:00Z',
          },
        ],
      ])
    )

    const candidates = await getStaleWorktreeCandidates('/repo')

    expect(candidates.map(candidate => candidate.branch)).toEqual([
      'feature-a',
      'feature-b',
      'feature-c',
    ])
    expect(candidates).toHaveLength(3)
  })

  test('ignores stale branches that do not have Port worktrees', async () => {
    mocks.getMergedBranches.mockResolvedValue(['feature-a', 'missing-branch'])

    const candidates = await getStaleWorktreeCandidates('/repo')

    expect(candidates.map(candidate => candidate.branch)).toEqual(['feature-a'])
  })

  test('deduplicates a branch reported by multiple detection paths', async () => {
    mocks.getMergedBranches.mockResolvedValue(['feature-a'])
    mocks.getGoneBranches.mockResolvedValue(['feature-a'])

    const candidates = await getStaleWorktreeCandidates('/repo')

    expect(candidates.map(candidate => candidate.branch)).toEqual(['feature-a'])
  })

  test('returns git-based candidates when gh is unavailable', async () => {
    mocks.getMergedBranches.mockResolvedValue(['feature-a'])
    mocks.isGhAvailable.mockResolvedValue(false)

    const candidates = await getStaleWorktreeCandidates('/repo')

    expect(candidates.map(candidate => candidate.branch)).toEqual(['feature-a'])
    expect(mocks.getMergedPrBranches).not.toHaveBeenCalled()
  })
})

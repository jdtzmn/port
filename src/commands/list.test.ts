import { existsSync, readdirSync } from 'fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  getTreesDir: vi.fn(),
  listWorktrees: vi.fn(),
  getStaleWorktreeCandidates: vi.fn(),
  STALE_WORKTREE_WARNING_THRESHOLD: 10,
  formatStaleWorktreeWarning: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  getTreesDir: mocks.getTreesDir,
}))

vi.mock('../lib/git.ts', () => ({
  listWorktrees: mocks.listWorktrees,
}))

vi.mock('../lib/staleWorktrees.ts', () => ({
  getStaleWorktreeCandidates: mocks.getStaleWorktreeCandidates,
  STALE_WORKTREE_WARNING_THRESHOLD: mocks.STALE_WORKTREE_WARNING_THRESHOLD,
  formatStaleWorktreeWarning: mocks.formatStaleWorktreeWarning,
}))

vi.mock('../lib/output.ts', () => ({
  warn: mocks.warn,
}))

vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readdirSync: vi.fn(actual.readdirSync),
  }
})

import { list, getWorktreeNames, getWorktreeNamesWithOriginals } from './list.ts'

describe('list command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.getTreesDir.mockReturnValue('/repo/.port/trees')
    mocks.listWorktrees.mockResolvedValue([])
    mocks.getStaleWorktreeCandidates.mockResolvedValue([])
    mocks.formatStaleWorktreeWarning.mockImplementation(
      (count: number) => `You have ${count} stale port worktrees. Consider running port prune.`
    )
  })

  test('prints worktree names one per line', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'feature-a', isDirectory: () => true },
      { name: 'feature-b', isDirectory: () => true },
      { name: '.gitkeep', isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>)

    await list()

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toContain('repo')
    expect(outputLines).toContain('feature-a')
    expect(outputLines).toContain('feature-b')
    expect(outputLines).not.toContain('.gitkeep')
    logSpy.mockRestore()
  })

  test('includes original unsanitized branch names', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'jacob-test-sanitation', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      {
        path: '/repo/.port/trees/jacob-test-sanitation',
        branch: 'jacob/test/sanitation',
        isMain: false,
      },
    ])

    await list()

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toContain('jacob-test-sanitation')
    expect(outputLines).toContain('jacob/test/sanitation')
    logSpy.mockRestore()
  })

  test('does not duplicate names when branch is already sanitized', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'my-feature', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      {
        path: '/repo/.port/trees/my-feature',
        branch: 'my-feature',
        isMain: false,
      },
    ])

    await list()

    const outputLines = logSpy.mock.calls.map(call => call[0])
    const myFeatureCount = outputLines.filter((l: string) => l === 'my-feature').length
    expect(myFeatureCount).toBe(1)
    logSpy.mockRestore()
  })

  test('outputs nothing when not in a git repo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('Not in a git repository')
    })

    await list()

    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('still lists names when config does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(false)

    await list()

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toEqual(['repo'])
    logSpy.mockRestore()
  })

  test('includes main repo name even when trees dir does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(false)

    await list()

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toContain('repo')
    logSpy.mockRestore()
  })

  test('falls back to directory names when git worktree list fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'jacob-test-sanitation', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockRejectedValue(new Error('git not available'))

    await list()

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toContain('repo')
    expect(outputLines).toContain('jacob-test-sanitation')
    // Original name not available since git failed
    expect(outputLines).not.toContain('jacob/test/sanitation')
    logSpy.mockRestore()
  })

  test('shows a stale worktree warning after listing names when the threshold is reached', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(false)
    mocks.getStaleWorktreeCandidates.mockResolvedValue([
      { branch: 'feature-a', sanitized: 'feature-a', reason: 'merged' },
      { branch: 'feature-b', sanitized: 'feature-b', reason: 'gone' },
      { branch: 'feature-c', sanitized: 'feature-c', reason: 'pr-merged' },
      { branch: 'feature-d', sanitized: 'feature-d', reason: 'merged' },
      { branch: 'feature-e', sanitized: 'feature-e', reason: 'gone' },
      { branch: 'feature-f', sanitized: 'feature-f', reason: 'merged' },
      { branch: 'feature-g', sanitized: 'feature-g', reason: 'merged' },
      { branch: 'feature-h', sanitized: 'feature-h', reason: 'merged' },
      { branch: 'feature-i', sanitized: 'feature-i', reason: 'merged' },
      { branch: 'feature-j', sanitized: 'feature-j', reason: 'merged' },
    ])

    await list()

    expect(mocks.warn).toHaveBeenCalledWith(
      'You have 10 stale port worktrees. Consider running port prune.'
    )
    logSpy.mockRestore()
  })

  test('does not show a stale worktree warning below the threshold', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(false)
    mocks.getStaleWorktreeCandidates.mockResolvedValue([
      { branch: 'feature-a', sanitized: 'feature-a', reason: 'merged' },
      { branch: 'feature-b', sanitized: 'feature-b', reason: 'gone' },
      { branch: 'feature-c', sanitized: 'feature-c', reason: 'pr-merged' },
      { branch: 'feature-d', sanitized: 'feature-d', reason: 'merged' },
      { branch: 'feature-e', sanitized: 'feature-e', reason: 'gone' },
      { branch: 'feature-f', sanitized: 'feature-f', reason: 'merged' },
      { branch: 'feature-g', sanitized: 'feature-g', reason: 'merged' },
      { branch: 'feature-h', sanitized: 'feature-h', reason: 'merged' },
      { branch: 'feature-i', sanitized: 'feature-i', reason: 'merged' },
    ])

    await list()

    expect(mocks.warn).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('continues listing names if stale worktree lookup fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(false)
    mocks.getStaleWorktreeCandidates.mockRejectedValue(new Error('lookup failed'))

    await list()

    expect(logSpy.mock.calls.map(call => call[0])).toEqual(['repo'])
    expect(mocks.warn).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })
})

describe('getWorktreeNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTreesDir.mockReturnValue('/repo/.port/trees')
  })

  test('returns main repo name and tree directory names', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'branch-1', isDirectory: () => true },
      { name: 'branch-2', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)

    const names = getWorktreeNames('/my/repo')
    expect(names).toEqual(['repo', 'branch-1', 'branch-2'])
  })

  test('returns only main repo name when trees dir does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const names = getWorktreeNames('/my/repo')
    expect(names).toEqual(['repo'])
  })

  test('filters out non-directory entries', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'valid-branch', isDirectory: () => true },
      { name: '.gitkeep', isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>)

    const names = getWorktreeNames('/my/repo')
    expect(names).toEqual(['repo', 'valid-branch'])
  })
})

describe('getWorktreeNamesWithOriginals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTreesDir.mockReturnValue('/repo/.port/trees')
    mocks.listWorktrees.mockResolvedValue([])
  })

  test('includes both sanitized and original branch names', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'jacob-test-sanitation', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      {
        path: '/repo/.port/trees/jacob-test-sanitation',
        branch: 'jacob/test/sanitation',
        isMain: false,
      },
    ])

    const names = await getWorktreeNamesWithOriginals('/repo')
    expect(names).toContain('jacob-test-sanitation')
    expect(names).toContain('jacob/test/sanitation')
  })

  test('does not duplicate when branch name equals sanitized name', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'my-feature', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/repo/.port/trees/my-feature', branch: 'my-feature', isMain: false },
    ])

    const names = await getWorktreeNamesWithOriginals('/repo')
    const count = names.filter(n => n === 'my-feature').length
    expect(count).toBe(1)
  })

  test('handles multiple branches with different sanitization', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'feature-auth-api', isDirectory: () => true },
      { name: 'fix-bug-123', isDirectory: () => true },
      { name: 'clean-branch', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      {
        path: '/repo/.port/trees/feature-auth-api',
        branch: 'feature/auth-api',
        isMain: false,
      },
      {
        path: '/repo/.port/trees/fix-bug-123',
        branch: 'fix/bug#123',
        isMain: false,
      },
      {
        path: '/repo/.port/trees/clean-branch',
        branch: 'clean-branch',
        isMain: false,
      },
    ])

    const names = await getWorktreeNamesWithOriginals('/repo')
    // Sanitized names
    expect(names).toContain('feature-auth-api')
    expect(names).toContain('fix-bug-123')
    expect(names).toContain('clean-branch')
    // Original names (only when different)
    expect(names).toContain('feature/auth-api')
    expect(names).toContain('fix/bug#123')
  })

  test('falls back to directory names when git fails', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'some-branch', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockRejectedValue(new Error('git not found'))

    const names = await getWorktreeNamesWithOriginals('/repo')
    expect(names).toContain('repo')
    expect(names).toContain('some-branch')
  })

  test('ignores worktrees not under .port/trees/', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'managed-branch', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>)
    mocks.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      {
        path: '/repo/.port/trees/managed-branch',
        branch: 'managed/branch',
        isMain: false,
      },
      {
        path: '/some/other/location',
        branch: 'external/branch',
        isMain: false,
      },
    ])

    const names = await getWorktreeNamesWithOriginals('/repo')
    expect(names).toContain('managed/branch')
    expect(names).not.toContain('external/branch')
  })
})

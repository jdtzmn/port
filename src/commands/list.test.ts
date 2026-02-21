import { existsSync, readdirSync } from 'fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  getComposeFile: vi.fn(),
  getTreesDir: vi.fn(),
  collectWorktreeStatuses: vi.fn(),
  cleanupStaleHostServices: vi.fn(),
  getAllHostServices: vi.fn(),
  isProcessRunning: vi.fn(),
  isTraefikRunning: vi.fn(),
  listWorktrees: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  branch: vi.fn(),
  success: vi.fn(),
  dim: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  url: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  configExists: mocks.configExists,
  loadConfig: mocks.loadConfig,
  getComposeFile: mocks.getComposeFile,
  getTreesDir: mocks.getTreesDir,
}))

vi.mock('../lib/worktreeStatus.ts', () => ({
  collectWorktreeStatuses: mocks.collectWorktreeStatuses,
}))

vi.mock('../lib/hostService.ts', () => ({
  isProcessRunning: mocks.isProcessRunning,
  cleanupStaleHostServices: mocks.cleanupStaleHostServices,
}))

vi.mock('../lib/registry.ts', () => ({
  getAllHostServices: mocks.getAllHostServices,
}))

vi.mock('../lib/compose.ts', () => ({
  isTraefikRunning: mocks.isTraefikRunning,
}))

vi.mock('../lib/git.ts', () => ({
  listWorktrees: mocks.listWorktrees,
}))

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  newline: mocks.newline,
  branch: mocks.branch,
  success: mocks.success,
  dim: mocks.dim,
  info: mocks.info,
  error: mocks.error,
  url: mocks.url,
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
    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.cleanupStaleHostServices.mockResolvedValue(undefined)
    mocks.getAllHostServices.mockResolvedValue([])
    mocks.isProcessRunning.mockReturnValue(true)
    mocks.isTraefikRunning.mockResolvedValue(false)
    mocks.branch.mockImplementation((value: string) => value)
    mocks.url.mockImplementation((value: string) => value)
  })

  test('prints concise worktree summary without per-service lines', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.collectWorktreeStatuses.mockResolvedValue([
      {
        name: 'main',
        path: '/repo',
        running: true,
        services: [{ name: 'web', ports: [3000], running: true }],
      },
    ])

    await list()

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toContain('main (running)')
    expect(outputLines.some(line => String(line).includes('web: 3000'))).toBe(false)
    expect(mocks.header).toHaveBeenCalledWith('Active worktrees:')
    logSpy.mockRestore()
  })

  test('includes host services in summary output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.collectWorktreeStatuses.mockResolvedValue([
      {
        name: 'main',
        path: '/repo',
        running: false,
        services: [],
      },
    ])
    mocks.getAllHostServices.mockResolvedValue([
      {
        repo: '/repo',
        branch: 'feature-a',
        logicalPort: 3000,
        actualPort: 49152,
        pid: 999,
        configFile: '/tmp/feature-a-3000.yml',
      },
    ])

    await list()

    const outputLines = logSpy.mock.calls.map(call => String(call[0]))
    expect(outputLines).toContain('feature-a:3000 -> localhost:49152 (running)')
    expect(outputLines).toContain('  pid: 999')
    expect(mocks.cleanupStaleHostServices).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  test('outside a git repository shows global service status without hard error', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('Not in a git repository')
    })

    await expect(list()).resolves.toBeUndefined()

    expect(mocks.info).toHaveBeenCalledWith(
      'Not in a git repository. Showing global service status only.'
    )
    expect(mocks.collectWorktreeStatuses).not.toHaveBeenCalled()
    expect(mocks.cleanupStaleHostServices).toHaveBeenCalledTimes(1)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  test('in non-port repo shows global service status without hard error', async () => {
    mocks.configExists.mockReturnValue(false)

    await expect(list()).resolves.toBeUndefined()

    expect(mocks.info).toHaveBeenCalledWith(
      'Current repository is not initialized with port. Showing global service status only.'
    )
    expect(mocks.collectWorktreeStatuses).not.toHaveBeenCalled()
    expect(mocks.cleanupStaleHostServices).toHaveBeenCalledTimes(1)
    expect(mocks.error).not.toHaveBeenCalled()
  })
})

describe('list --names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.configExists.mockReturnValue(true)
    mocks.getTreesDir.mockReturnValue('/repo/.port/trees')
    mocks.listWorktrees.mockResolvedValue([])
  })

  test('prints worktree names one per line', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'feature-a', isDirectory: () => true },
      { name: 'feature-b', isDirectory: () => true },
      { name: '.gitkeep', isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>)

    await list({ names: true })

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toContain('repo')
    expect(outputLines).toContain('feature-a')
    expect(outputLines).toContain('feature-b')
    expect(outputLines).not.toContain('.gitkeep')
    // Should not call expensive Docker/Traefik checks
    expect(mocks.collectWorktreeStatuses).not.toHaveBeenCalled()
    expect(mocks.cleanupStaleHostServices).not.toHaveBeenCalled()
    expect(mocks.isTraefikRunning).not.toHaveBeenCalled()
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

    await list({ names: true })

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

    await list({ names: true })

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

    await list({ names: true })

    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('outputs nothing when config does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.configExists.mockReturnValue(false)

    await list({ names: true })

    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('includes main repo name even when trees dir does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(existsSync).mockReturnValue(false)

    await list({ names: true })

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

    await list({ names: true })

    const outputLines = logSpy.mock.calls.map(call => call[0])
    expect(outputLines).toContain('repo')
    expect(outputLines).toContain('jacob-test-sanitation')
    // Original name not available since git failed
    expect(outputLines).not.toContain('jacob/test/sanitation')
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

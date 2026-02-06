import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  getComposeFile: vi.fn(),
  collectWorktreeStatuses: vi.fn(),
  cleanupStaleHostServices: vi.fn(),
  getAllHostServices: vi.fn(),
  isProcessRunning: vi.fn(),
  isTraefikRunning: vi.fn(),
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

import { list } from './list.ts'

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

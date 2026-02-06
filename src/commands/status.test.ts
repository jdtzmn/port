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
  error: mocks.error,
  url: mocks.url,
}))

import { status } from './status.ts'

describe('status command', () => {
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

  test('prints per-service details grouped by worktree', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.collectWorktreeStatuses.mockResolvedValue([
      {
        name: 'main',
        path: '/repo',
        running: true,
        services: [
          { name: 'api', ports: [3000], running: true },
          { name: 'db', ports: [], running: false },
        ],
      },
    ])

    await status()

    const outputLines = logSpy.mock.calls.map(call => String(call[0]))
    expect(outputLines).toContain('main (running)')
    expect(outputLines).toContain('  api: 3000 (running)')
    expect(outputLines).toContain('  db: no published ports (stopped)')
    expect(mocks.header).toHaveBeenCalledWith('Worktree service status:')
    logSpy.mockRestore()
  })
})

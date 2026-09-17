import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  getTreesDir: vi.fn(),
  parseComposeFile: vi.fn(),
  composePs: vi.fn(),
  getServicePorts: vi.fn(),
  buildProjectName: vi.fn(),
  getRunningComposeServiceInventory: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  readdirSync: mocks.readdirSync,
}))

vi.mock('./config.ts', () => ({
  getTreesDir: mocks.getTreesDir,
}))

vi.mock('./compose.ts', () => ({
  parseComposeFile: mocks.parseComposeFile,
  composePs: mocks.composePs,
  getServicePorts: mocks.getServicePorts,
}))

vi.mock('./projectName.ts', () => ({
  buildProjectName: mocks.buildProjectName,
}))

vi.mock('./dockerInventory.ts', () => ({
  getRunningComposeServiceInventory: mocks.getRunningComposeServiceInventory,
}))

import { collectWorktreeStatuses } from './worktreeStatus.ts'

describe('collectWorktreeStatuses Docker inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockReturnValue(true)
    mocks.readdirSync.mockReturnValue([{ name: 'feature', isDirectory: () => true }])
    mocks.getTreesDir.mockReturnValue('/repo/.port/trees')
    mocks.buildProjectName.mockImplementation(
      (repoRoot: string, branch: string) => `${repoRoot}:${branch}`
    )
    mocks.parseComposeFile.mockResolvedValue({
      services: {
        api: {},
        worker: {},
      },
    })
    mocks.getServicePorts.mockReturnValue([])
  })

  test('uses one Docker inventory instead of per-worktree compose ps calls', async () => {
    mocks.getRunningComposeServiceInventory.mockResolvedValue(
      new Map([
        ['/repo:repo', new Set(['api'])],
        ['/repo:feature', new Set(['worker'])],
      ])
    )

    const statuses = await collectWorktreeStatuses('/repo', 'docker-compose.yml', 'port')

    expect(mocks.getRunningComposeServiceInventory).toHaveBeenCalledTimes(1)
    expect(mocks.composePs).not.toHaveBeenCalled()
    expect(statuses).toEqual([
      {
        name: 'repo',
        path: '/repo',
        running: true,
        services: [
          { name: 'api', ports: [], running: true },
          { name: 'worker', ports: [], running: false },
        ],
      },
      {
        name: 'feature',
        path: '/repo/.port/trees/feature',
        running: true,
        services: [
          { name: 'api', ports: [], running: false },
          { name: 'worker', ports: [], running: true },
        ],
      },
    ])
  })

  test('treats worktrees absent from an available inventory as stopped', async () => {
    mocks.getRunningComposeServiceInventory.mockResolvedValue(
      new Map([['/repo:repo', new Set(['api'])]])
    )

    const statuses = await collectWorktreeStatuses('/repo', 'docker-compose.yml', 'port')

    expect(mocks.composePs).not.toHaveBeenCalled()
    expect(statuses[1]?.services).toEqual([
      { name: 'api', ports: [], running: false },
      { name: 'worker', ports: [], running: false },
    ])
  })

  test('falls back to compose ps when the Docker inventory is unavailable', async () => {
    mocks.getRunningComposeServiceInventory.mockResolvedValue(null)
    mocks.composePs.mockResolvedValue([{ name: 'repo-api-1', running: true }])

    const statuses = await collectWorktreeStatuses('/repo', 'docker-compose.yml', 'port')

    expect(mocks.composePs).toHaveBeenCalledTimes(2)
    expect(statuses[0]?.services[0]).toEqual({ name: 'api', ports: [], running: true })
  })
})

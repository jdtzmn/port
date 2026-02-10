import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  getComposeFile: vi.fn(),
  parseComposeFile: vi.fn(),
  getServicePorts: vi.fn(),
  header: vi.fn(),
  serviceUrls: vi.fn(),
  branch: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  configExists: mocks.configExists,
  loadConfig: mocks.loadConfig,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/compose.ts', () => ({
  parseComposeFile: mocks.parseComposeFile,
  getServicePorts: mocks.getServicePorts,
}))

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  serviceUrls: mocks.serviceUrls,
  branch: mocks.branch,
  error: mocks.error,
  warn: mocks.warn,
}))

import { urls } from './urls.ts'

describe('urls command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo/.port/trees/feature-1',
      name: 'feature-1',
      isMainRepo: false,
    })
    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.branch.mockImplementation((value: string) => value)

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
  })

  test('prints all service URLs for the current worktree', async () => {
    const web = {}
    const db = {}

    mocks.parseComposeFile.mockResolvedValue({
      name: 'repo',
      services: {
        web,
        db,
      },
    })
    mocks.getServicePorts.mockImplementation((service: object) => {
      if (service === web) return [3000]
      if (service === db) return [5432]
      return []
    })

    await urls()

    expect(mocks.header).toHaveBeenCalledWith('Service URLs for feature-1:')
    expect(mocks.serviceUrls).toHaveBeenCalledWith([
      { name: 'web', urls: ['http://feature-1.port:3000'] },
      { name: 'db', urls: ['http://feature-1.port:5432'] },
    ])
  })

  test('filters URLs by service name', async () => {
    const web = {}
    const db = {}

    mocks.parseComposeFile.mockResolvedValue({
      name: 'repo',
      services: {
        web,
        db,
      },
    })
    mocks.getServicePorts.mockImplementation((service: object) => {
      if (service === web) return [3000]
      if (service === db) return [5432]
      return []
    })

    await urls('web')

    expect(mocks.serviceUrls).toHaveBeenCalledWith([
      { name: 'web', urls: ['http://feature-1.port:3000'] },
    ])
  })

  test('fails when requested service does not exist', async () => {
    mocks.parseComposeFile.mockResolvedValue({
      name: 'repo',
      services: {
        web: {},
      },
    })
    mocks.getServicePorts.mockReturnValue([3000])

    await expect(urls('ui-frontend')).rejects.toThrow('process.exit:1')

    expect(mocks.error).toHaveBeenCalledWith('Service "ui-frontend" not found in current worktree')
  })

  test('fails when run in main repository instead of worktree', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'repo',
      isMainRepo: true,
    })

    await expect(urls()).rejects.toThrow('process.exit:1')

    expect(mocks.error).toHaveBeenCalledWith('port urls must be run inside a port worktree')
  })
})

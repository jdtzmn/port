import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  ensurePortRuntimeDir: vi.fn(),
  loadConfigOrDefault: vi.fn(),
  getComposeFile: vi.fn(),
  parseComposeFile: vi.fn(),
  getServicePorts: vi.fn(),
  composePs: vi.fn(),
  buildProjectName: vi.fn(),
  header: vi.fn(),
  serviceUrls: vi.fn(),
  branch: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  url: vi.fn(),
  dim: vi.fn(),
  findRemoteRuntimePaths: vi.fn(),
  readRemoteRouteView: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  ensurePortRuntimeDir: mocks.ensurePortRuntimeDir,
  loadConfigOrDefault: mocks.loadConfigOrDefault,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/compose.ts', () => ({
  parseComposeFile: mocks.parseComposeFile,
  getServicePorts: mocks.getServicePorts,
  composePs: mocks.composePs,
}))

vi.mock('../lib/projectName.ts', () => ({
  buildProjectName: mocks.buildProjectName,
}))

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  serviceUrls: mocks.serviceUrls,
  branch: mocks.branch,
  error: mocks.error,
  warn: mocks.warn,
  url: mocks.url,
  dim: mocks.dim,
}))

vi.mock('../lib/remote/coordinator/paths.ts', () => ({
  findRemoteRuntimePaths: mocks.findRemoteRuntimePaths,
}))

vi.mock('../lib/remote/coordinator/store.ts', () => ({
  readRemoteRouteView: mocks.readRemoteRouteView,
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
    mocks.ensurePortRuntimeDir.mockResolvedValue(undefined)
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.branch.mockImplementation((value: string) => value)
    mocks.buildProjectName.mockReturnValue('repo-feature-1')
    mocks.url.mockImplementation((value: string) => value)
    mocks.dim.mockImplementation((value: string) => value)
    mocks.findRemoteRuntimePaths.mockResolvedValue(undefined)
    mocks.composePs.mockResolvedValue([])

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
      {
        name: 'web',
        urls: ['http://web.feature-1.port', 'http://feature-1.port:3000'],
        running: false,
      },
      {
        name: 'db',
        urls: ['http://db.feature-1.port', 'http://feature-1.port:5432'],
        running: false,
      },
    ])
  })

  test('includes a service-name alias for the first published port', async () => {
    const web = {}

    mocks.parseComposeFile.mockResolvedValue({
      name: 'repo',
      services: {
        web,
      },
    })
    mocks.getServicePorts.mockReturnValue([3000, 3001])

    await urls()

    expect(mocks.serviceUrls).toHaveBeenCalledWith([
      {
        name: 'web',
        urls: [
          'http://web.feature-1.port',
          'http://feature-1.port:3000',
          'http://feature-1.port:3001',
        ],
        running: false,
      },
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
      {
        name: 'web',
        urls: ['http://web.feature-1.port', 'http://feature-1.port:3000'],
        running: false,
      },
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

  test('prints service URLs when run in the main repository', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'repo',
      isMainRepo: true,
    })

    mocks.parseComposeFile.mockResolvedValue({
      name: 'repo',
      services: {
        web: {},
      },
    })
    mocks.getServicePorts.mockReturnValue([3000])

    await urls()

    expect(mocks.header).toHaveBeenCalledWith('Service URLs for repo:')
    expect(mocks.serviceUrls).toHaveBeenCalledWith([
      {
        name: 'web',
        urls: ['http://web.repo.port', 'http://repo.port:3000'],
        running: false,
      },
    ])
  })

  test('marks services as running when containers are up', async () => {
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
    mocks.composePs.mockResolvedValue([
      { name: 'repo-feature-1-web-1', running: true },
      { name: 'repo-feature-1-db-1', running: false },
    ])

    await urls()

    expect(mocks.serviceUrls).toHaveBeenCalledWith([
      {
        name: 'web',
        urls: ['http://web.feature-1.port', 'http://feature-1.port:3000'],
        running: true,
      },
      {
        name: 'db',
        urls: ['http://db.feature-1.port', 'http://feature-1.port:5432'],
        running: false,
      },
    ])
  })

  test('scopes remote route output to the current worktree namespace', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.findRemoteRuntimePaths.mockResolvedValue({ root: '/remote' })
    mocks.readRemoteRouteView.mockResolvedValue({
      version: 1,
      routes: [
        {
          namespace: 'feature-1.port',
          hostname: 'ui.feature-1.port',
          port: 80,
          transport: 'http',
          availability: 'ready',
          serviceName: 'ui',
        },
        {
          namespace: 'other.port',
          hostname: 'ui.other.port',
          port: 80,
          transport: 'http',
          availability: 'ready',
          serviceName: 'ui',
        },
      ],
    })

    await urls('ui')

    expect(mocks.header).toHaveBeenCalledWith('Remote service URLs for feature-1:')
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ui.feature-1.port'))
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('ui.other.port'))
    expect(mocks.parseComposeFile).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  test('lists all remote routes only when explicitly requested', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('outside repository')
    })
    mocks.findRemoteRuntimePaths.mockResolvedValue({ root: '/remote' })
    mocks.readRemoteRouteView.mockResolvedValue({
      version: 1,
      routes: [
        {
          namespace: 'feature-1.port',
          hostname: 'ui.feature-1.port',
          port: 80,
          transport: 'http',
          availability: 'ready',
        },
        {
          namespace: 'other.port',
          hostname: 'ui.other.port',
          port: 80,
          transport: 'http',
          availability: 'ready',
        },
      ],
    })

    await urls(undefined, { remote: true })

    expect(mocks.header).toHaveBeenCalledWith('Remote service URLs:')
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ui.feature-1.port'))
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ui.other.port'))
    stderr.mockRestore()
  })
})

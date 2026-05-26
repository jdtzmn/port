import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  ensurePortRuntimeDir: vi.fn(),
  loadConfigOrDefault: vi.fn(),
  getComposeFile: vi.fn(),
  checkDns: vi.fn(),
  registerProject: vi.fn(),
  ensureTraefikPorts: vi.fn(),
  traefikFilesExist: vi.fn(),
  initTraefikFiles: vi.fn(),
  runCompose: vi.fn(),
  writeOverrideFile: vi.fn(),
  startTraefik: vi.fn(),
  isTraefikRunning: vi.fn(),
  restartTraefik: vi.fn(),
  traefikHasRequiredPorts: vi.fn(),
  checkComposeVersion: vi.fn(),
  parseComposeFile: vi.fn(),
  getAllPorts: vi.fn(),
  getServicePorts: vi.fn(),
  resolveComposeServices: vi.fn(),
  getProjectName: vi.fn(),
  hookExists: vi.fn(),
  runPostUpHook: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
  serviceUrls: vi.fn(),
  url: vi.fn(),
  branch: vi.fn(),
  command: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  ensurePortRuntimeDir: mocks.ensurePortRuntimeDir,
  loadConfigOrDefault: mocks.loadConfigOrDefault,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/dns.ts', () => ({
  checkDns: mocks.checkDns,
}))

vi.mock('../lib/registry.ts', () => ({
  registerProject: mocks.registerProject,
}))

vi.mock('../lib/traefik.ts', () => ({
  ensureTraefikPorts: mocks.ensureTraefikPorts,
  traefikFilesExist: mocks.traefikFilesExist,
  initTraefikFiles: mocks.initTraefikFiles,
  ensure404HandlerImage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/compose.ts', () => ({
  runCompose: mocks.runCompose,
  writeOverrideFile: mocks.writeOverrideFile,
  startTraefik: mocks.startTraefik,
  isTraefikRunning: mocks.isTraefikRunning,
  restartTraefik: mocks.restartTraefik,
  traefikHasRequiredPorts: mocks.traefikHasRequiredPorts,
  checkComposeVersion: mocks.checkComposeVersion,
  parseComposeFile: mocks.parseComposeFile,
  getAllPorts: mocks.getAllPorts,
  getServicePorts: mocks.getServicePorts,
  resolveComposeServices: mocks.resolveComposeServices,
  getProjectName: mocks.getProjectName,
}))

vi.mock('../lib/hooks.ts', () => ({
  hookExists: mocks.hookExists,
  runPostUpHook: mocks.runPostUpHook,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  warn: mocks.warn,
  error: mocks.error,
  info: mocks.info,
  dim: mocks.dim,
  newline: mocks.newline,
  serviceUrls: mocks.serviceUrls,
  url: mocks.url,
  branch: mocks.branch,
  command: mocks.command,
}))

import { up } from './up.ts'

describe('up DNS preflight', () => {
  const exitError = (code: number | undefined) => new Error(`process.exit:${code ?? 0}`)
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'main',
      isMainRepo: true,
    })
    mocks.ensurePortRuntimeDir.mockResolvedValue(undefined)
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.checkDns.mockResolvedValue(true)

    mocks.checkComposeVersion.mockResolvedValue({ supported: true, version: '2.24.0' })
    mocks.parseComposeFile.mockResolvedValue({ name: 'repo', services: {} })
    mocks.getAllPorts.mockReturnValue([])
    mocks.traefikFilesExist.mockReturnValue(true)
    mocks.ensureTraefikPorts.mockResolvedValue(false)
    mocks.isTraefikRunning.mockResolvedValue(true)
    mocks.traefikHasRequiredPorts.mockResolvedValue(true)
    mocks.getProjectName.mockReturnValue('repo-main')
    mocks.resolveComposeServices.mockReturnValue([])
    mocks.writeOverrideFile.mockResolvedValue(undefined)
    mocks.runCompose.mockResolvedValue({ exitCode: 0 })
    mocks.registerProject.mockResolvedValue(undefined)
    mocks.getServicePorts.mockReturnValue([])
    mocks.hookExists.mockResolvedValue(false)
    mocks.runPostUpHook.mockResolvedValue({ success: true, exitCode: 0 })

    mocks.url.mockImplementation((value: string) => value)
    mocks.branch.mockImplementation((value: string) => value)
    mocks.command.mockImplementation((value: string) => value)

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw exitError(typeof code === 'number' ? code : 0)
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
  })

  test('exits early with setup guidance when default domain DNS is not configured', async () => {
    mocks.checkDns.mockResolvedValue(false)

    await expect(up()).rejects.toThrow('process.exit:1')

    expect(mocks.warn).toHaveBeenCalledWith('DNS is not configured for *.port domains')
    expect(mocks.info).toHaveBeenCalledWith("Run 'port install' to set up DNS")
    expect(mocks.parseComposeFile).not.toHaveBeenCalled()
    expect(mocks.runCompose).not.toHaveBeenCalled()
  })

  test('exits early with custom-domain install command when DNS is not configured', async () => {
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'custom', compose: 'docker-compose.yml' })
    mocks.checkDns.mockResolvedValue(false)

    await expect(up()).rejects.toThrow('process.exit:1')

    expect(mocks.warn).toHaveBeenCalledWith('DNS is not configured for *.custom domains')
    expect(mocks.info).toHaveBeenCalledWith("Run 'port install --domain custom' to set up DNS")
    expect(mocks.parseComposeFile).not.toHaveBeenCalled()
  })

  test('continues startup when DNS is configured', async () => {
    await up()

    expect(mocks.checkDns).toHaveBeenCalledWith('port')
    expect(mocks.parseComposeFile).toHaveBeenCalledWith('/repo', 'docker-compose.yml')
    expect(mocks.runCompose).toHaveBeenCalled()
  })

  test('starts only requested services while surfacing dependency URLs', async () => {
    mocks.parseComposeFile.mockResolvedValue({
      name: 'repo',
      services: {
        app: {
          ports: [{ published: 3000, target: 3000 }],
        },
        postgres: {
          ports: [{ published: 5432, target: 5432 }],
        },
      },
    })
    mocks.getAllPorts.mockReturnValue([3000, 5432])
    mocks.resolveComposeServices.mockReturnValue(['app', 'postgres'])
    mocks.getServicePorts.mockImplementation(
      (service: { ports?: Array<{ published: number }> }) =>
        service.ports?.map(port => port.published) ?? []
    )

    await up(['app'])

    expect(mocks.runCompose).toHaveBeenCalledWith(
      '/repo',
      'docker-compose.yml',
      'repo-main',
      ['up', '-d', 'app'],
      {
        repoRoot: '/repo',
        branch: 'main',
        domain: 'port',
      }
    )
    expect(mocks.serviceUrls).toHaveBeenCalledWith([
      {
        name: 'app',
        urls: ['http://main.port:3000'],
      },
      {
        name: 'postgres',
        urls: ['http://main.port:5432'],
      },
    ])
  })

  test('fails before compose when a requested service is missing', async () => {
    mocks.resolveComposeServices.mockImplementation(() => {
      throw new Error('Service "missing" not found in compose file')
    })

    await expect(up(['missing'])).rejects.toThrow('process.exit:1')

    expect(mocks.error).toHaveBeenCalledWith('Service "missing" not found in compose file')
    expect(mocks.runCompose).not.toHaveBeenCalled()
  })

  test('does not start independent sibling services when one is requested', async () => {
    // Three siblings with no `depends_on` between them. Requesting `app`
    // must only forward `app` to docker compose and only surface the `app`
    // URL — `postgres` and `redis` must not be referenced anywhere.
    mocks.parseComposeFile.mockResolvedValue({
      name: 'repo',
      services: {
        app: {
          ports: [{ published: 3000, target: 3000 }],
        },
        postgres: {
          ports: [{ published: 5432, target: 5432 }],
        },
        redis: {
          ports: [{ published: 6379, target: 6379 }],
        },
      },
    })
    mocks.getAllPorts.mockReturnValue([3000, 5432, 6379])
    mocks.resolveComposeServices.mockReturnValue(['app'])
    mocks.getServicePorts.mockImplementation(
      (service: { ports?: Array<{ published: number }> }) =>
        service.ports?.map(port => port.published) ?? []
    )

    await up(['app'])

    // Compose is invoked exactly once, and the args carry only `app` —
    // never `postgres`/`redis` as trailing positionals.
    expect(mocks.runCompose).toHaveBeenCalledTimes(1)
    const composeCall = mocks.runCompose.mock.calls[0]!
    expect(composeCall[3]).toEqual(['up', '-d', 'app'])

    // URL surface is restricted to the resolved set. Asserting the exact
    // argument array (rather than `toContainEqual`) guards against any
    // future regression that would silently add sibling URLs.
    expect(mocks.serviceUrls).toHaveBeenCalledTimes(1)
    expect(mocks.serviceUrls).toHaveBeenCalledWith([
      {
        name: 'app',
        urls: ['http://main.port:3000'],
      },
    ])
  })

  test('runs post-up hook when configured', async () => {
    mocks.hookExists.mockResolvedValue(true)

    await up()

    expect(mocks.info).toHaveBeenCalledWith('Running post-up hook...')
    expect(mocks.runPostUpHook).toHaveBeenCalledWith({
      repoRoot: '/repo',
      worktreePath: '/repo',
      branch: 'main',
      domain: 'port',
    })
    expect(mocks.success).toHaveBeenCalledWith('Post-up hook completed')
  })

  test('warns when post-up hook fails and still succeeds', async () => {
    mocks.hookExists.mockResolvedValue(true)
    mocks.runPostUpHook.mockResolvedValue({ success: false, exitCode: 7 })

    await up()

    expect(mocks.warn).toHaveBeenCalledWith('Post-up hook failed (exit code 7)')
    expect(mocks.dim).toHaveBeenCalledWith('See .port/logs/latest.log for details')
  })
})

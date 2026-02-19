import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
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
  getProjectName: vi.fn(),
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
  configExists: mocks.configExists,
  loadConfig: mocks.loadConfig,
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
  getProjectName: mocks.getProjectName,
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
    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
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
    mocks.writeOverrideFile.mockResolvedValue(undefined)
    mocks.runCompose.mockResolvedValue({ exitCode: 0 })
    mocks.registerProject.mockResolvedValue(undefined)
    mocks.getServicePorts.mockReturnValue([])

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
    mocks.loadConfig.mockResolvedValue({ domain: 'custom', compose: 'docker-compose.yml' })
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
})

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  getComposeFile: vi.fn(),
  unregisterProject: vi.fn(),
  hasRegisteredProjects: vi.fn(),
  getHostServicesForWorktree: vi.fn(),
  getProjectCount: vi.fn(),
  runCompose: vi.fn(),
  stopTraefik: vi.fn(),
  isTraefikRunning: vi.fn(),
  getProjectName: vi.fn(),
  stopHostService: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
  branch: vi.fn(),
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
  },
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  configExists: mocks.configExists,
  loadConfig: mocks.loadConfig,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/registry.ts', () => ({
  unregisterProject: mocks.unregisterProject,
  hasRegisteredProjects: mocks.hasRegisteredProjects,
  getHostServicesForWorktree: mocks.getHostServicesForWorktree,
  getProjectCount: mocks.getProjectCount,
}))

vi.mock('../lib/compose.ts', () => ({
  runCompose: mocks.runCompose,
  stopTraefik: mocks.stopTraefik,
  isTraefikRunning: mocks.isTraefikRunning,
  getProjectName: mocks.getProjectName,
}))

vi.mock('../lib/hostService.ts', () => ({
  stopHostService: mocks.stopHostService,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  warn: mocks.warn,
  error: mocks.error,
  info: mocks.info,
  dim: mocks.dim,
  newline: mocks.newline,
  branch: mocks.branch,
}))

import { down } from './down.ts'

describe('down fallback behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('Not in a git repository')
    })

    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')

    mocks.unregisterProject.mockResolvedValue(undefined)
    mocks.hasRegisteredProjects.mockResolvedValue(false)
    mocks.getHostServicesForWorktree.mockResolvedValue([])
    mocks.getProjectCount.mockResolvedValue(0)

    mocks.runCompose.mockResolvedValue({ exitCode: 0 })
    mocks.stopTraefik.mockResolvedValue(undefined)
    mocks.isTraefikRunning.mockResolvedValue(true)
    mocks.getProjectName.mockReturnValue('demo-main')
    mocks.stopHostService.mockResolvedValue(undefined)

    mocks.prompt.mockResolvedValue({ stopTraefikConfirm: true })
    mocks.branch.mockImplementation((name: string) => name)
  })

  test('stops Traefik from outside a worktree with --yes', async () => {
    await down({ yes: true })

    expect(mocks.stopTraefik).toHaveBeenCalledTimes(1)
    expect(mocks.runCompose).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  test('prompts and can stop Traefik when projects are registered', async () => {
    mocks.getProjectCount.mockResolvedValue(2)

    await down()

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        message: '2 port project(s) still registered. Stop Traefik anyway?',
      }),
    ])
    expect(mocks.stopTraefik).toHaveBeenCalledTimes(1)
  })

  test('falls back to global Traefik shutdown when repo is not initialized', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'main',
      isMainRepo: true,
    })
    mocks.configExists.mockReturnValue(false)

    await down({ yes: true })

    expect(mocks.stopTraefik).toHaveBeenCalledTimes(1)
    expect(mocks.runCompose).not.toHaveBeenCalled()
    expect(mocks.unregisterProject).not.toHaveBeenCalled()
  })

  test('exits cleanly when Traefik is not running', async () => {
    mocks.isTraefikRunning.mockResolvedValue(false)

    await down({ yes: true })

    expect(mocks.stopTraefik).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith('Traefik is not running.')
  })

  test('still reaches Traefik shutdown when compose down throws', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'main',
      isMainRepo: true,
    })
    mocks.configExists.mockReturnValue(true)
    mocks.runCompose.mockRejectedValue(new Error('open .port/override.yml: no such file'))
    mocks.hasRegisteredProjects.mockResolvedValue(false)
    mocks.isTraefikRunning.mockResolvedValue(true)

    await down({ yes: true })

    expect(mocks.error).toHaveBeenCalledWith('Failed to stop services')
    expect(mocks.unregisterProject).toHaveBeenCalledWith('/repo', 'main')
    expect(mocks.stopTraefik).toHaveBeenCalledTimes(1)
  })
})

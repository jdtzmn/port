import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  detectWorktree: vi.fn(),
  ensurePortRuntimeDir: vi.fn(),
  loadConfigOrDefault: vi.fn(),
  getComposeFile: vi.fn(),
  unregisterProject: vi.fn(),
  hasRegisteredProjects: vi.fn(),
  getHostServicesForWorktree: vi.fn(),
  getProjectCount: vi.fn(),
  runCompose: vi.fn(),
  stopSharedStack: vi.fn(),
  isSharedStackRunning: vi.fn(),
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
  ensurePortRuntimeDir: mocks.ensurePortRuntimeDir,
  loadConfigOrDefault: mocks.loadConfigOrDefault,
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
  getProjectName: mocks.getProjectName,
}))

vi.mock('../lib/shared-stack.ts', () => ({
  stopSharedStack: mocks.stopSharedStack,
  isSharedStackRunning: mocks.isSharedStackRunning,
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

    mocks.ensurePortRuntimeDir.mockResolvedValue(undefined)
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')

    mocks.unregisterProject.mockResolvedValue(undefined)
    mocks.hasRegisteredProjects.mockResolvedValue(false)
    mocks.getHostServicesForWorktree.mockResolvedValue([])
    mocks.getProjectCount.mockResolvedValue(0)

    mocks.runCompose.mockResolvedValue({ exitCode: 0 })
    mocks.stopSharedStack.mockResolvedValue(undefined)
    mocks.isSharedStackRunning.mockResolvedValue(true)
    mocks.getProjectName.mockReturnValue('demo-main')
    mocks.stopHostService.mockResolvedValue(undefined)

    mocks.prompt.mockResolvedValue({ stopSharedStackConfirm: true })
    mocks.branch.mockImplementation((name: string) => name)
  })

  test('stops Traefik from outside a worktree with --yes', async () => {
    await down({ yes: true })

    expect(mocks.stopSharedStack).toHaveBeenCalledTimes(1)
    expect(mocks.runCompose).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  test('prompts and can stop Traefik when projects are registered', async () => {
    mocks.getProjectCount.mockResolvedValue(2)

    await down()

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        message: '2 port project(s) still registered. Stop port proxy anyway?',
      }),
    ])
    expect(mocks.stopSharedStack).toHaveBeenCalledTimes(1)
  })

  test('uses defaults and runs compose down when repo has no config file', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'main',
      isMainRepo: true,
    })
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })

    await down({ yes: true })

    expect(mocks.runCompose).toHaveBeenCalledTimes(1)
    expect(mocks.unregisterProject).toHaveBeenCalledWith('/repo', 'main')
  })

  test('exits cleanly when port is not running', async () => {
    mocks.isSharedStackRunning.mockResolvedValue(false)

    await down({ yes: true })

    expect(mocks.stopSharedStack).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith('port proxy is not running.')
  })

  test('still reaches Traefik shutdown when compose down throws', async () => {
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'main',
      isMainRepo: true,
    })
    mocks.runCompose.mockRejectedValue(new Error('open .port/override.yml: no such file'))
    mocks.hasRegisteredProjects.mockResolvedValue(false)
    mocks.isSharedStackRunning.mockResolvedValue(true)

    await down({ yes: true })

    expect(mocks.error).toHaveBeenCalledWith('Failed to stop services')
    expect(mocks.unregisterProject).toHaveBeenCalledWith('/repo', 'main')
    expect(mocks.stopSharedStack).toHaveBeenCalledTimes(1)
  })
})

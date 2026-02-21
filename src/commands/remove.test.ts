import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  detectWorktree: vi.fn(),
  worktreeExists: vi.fn(),
  getWorktreePath: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  getComposeFile: vi.fn(),
  findWorktreeByBranch: vi.fn(),
  archiveBranch: vi.fn(),
  removeWorktree: vi.fn(),
  removeWorktreeAtPath: vi.fn(),
  pruneWorktrees: vi.fn(),
  unregisterProject: vi.fn(),
  hasRegisteredProjects: vi.fn(),
  runCompose: vi.fn(),
  stopTraefik: vi.fn(),
  isTraefikRunning: vi.fn(),
  getProjectName: vi.fn(),
  existsSync: vi.fn(),
  exit: vi.fn(),
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
  worktreeExists: mocks.worktreeExists,
  getWorktreePath: mocks.getWorktreePath,
}))

vi.mock('../lib/config.ts', () => ({
  configExists: mocks.configExists,
  loadConfig: mocks.loadConfig,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/git.ts', () => ({
  findWorktreeByBranch: mocks.findWorktreeByBranch,
  archiveBranch: mocks.archiveBranch,
  removeWorktree: mocks.removeWorktree,
  removeWorktreeAtPath: mocks.removeWorktreeAtPath,
  pruneWorktrees: mocks.pruneWorktrees,
}))

vi.mock('../lib/registry.ts', () => ({
  unregisterProject: mocks.unregisterProject,
  hasRegisteredProjects: mocks.hasRegisteredProjects,
}))

vi.mock('../lib/compose.ts', () => ({
  runCompose: mocks.runCompose,
  stopTraefik: mocks.stopTraefik,
  isTraefikRunning: mocks.isTraefikRunning,
  getProjectName: mocks.getProjectName,
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
}))

vi.mock('./exit.ts', () => ({
  exit: mocks.exit,
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

import { remove } from './remove.ts'

describe('remove command', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PORT_WORKTREE

    mocks.exit.mockResolvedValue(undefined)
    mocks.detectWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo',
      name: 'repo',
      isMainRepo: true,
    })
    mocks.worktreeExists.mockReturnValue(true)
    mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/demo-2')

    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')

    mocks.findWorktreeByBranch.mockResolvedValue(null)
    mocks.archiveBranch.mockResolvedValue('archive/demo-2-20260206T120000Z')
    mocks.removeWorktree.mockResolvedValue(undefined)
    mocks.removeWorktreeAtPath.mockResolvedValue(undefined)
    mocks.pruneWorktrees.mockResolvedValue(undefined)

    mocks.unregisterProject.mockResolvedValue(undefined)
    mocks.hasRegisteredProjects.mockResolvedValue(false)

    mocks.runCompose.mockResolvedValue({ exitCode: 0 })
    mocks.stopTraefik.mockResolvedValue(undefined)
    mocks.isTraefikRunning.mockResolvedValue(false)
    mocks.getProjectName.mockReturnValue('repo-demo-2')

    mocks.existsSync.mockReturnValue(true)
    mocks.branch.mockImplementation((name: string) => name)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('removes a standard worktree path', async () => {
    await remove('demo-2')

    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
    expect(mocks.archiveBranch).toHaveBeenCalledWith('/repo', 'demo-2')
    expect(mocks.removeWorktreeAtPath).not.toHaveBeenCalled()
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  test('prompts before removing non-standard worktree path', async () => {
    const nestedPath = '/repo/.port/trees/demo-1/.port/trees/demo-2'
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue({
      path: nestedPath,
      branch: 'demo-2',
      isMain: false,
    })
    mocks.prompt.mockResolvedValue({ removeConfirm: true })

    await remove('demo-2')

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({ message: 'Remove this worktree anyway?' }),
    ])
    expect(mocks.runCompose).toHaveBeenCalledWith(
      nestedPath,
      'docker-compose.yml',
      'repo-demo-2',
      ['down'],
      {
        repoRoot: '/repo',
        branch: 'demo-2',
        domain: 'port',
      }
    )
    expect(mocks.removeWorktreeAtPath).toHaveBeenCalledWith('/repo', nestedPath, true)
    expect(mocks.archiveBranch).toHaveBeenCalledWith('/repo', 'demo-2')
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('skips prompt for non-standard path when --force is set', async () => {
    const nestedPath = '/repo/.port/trees/demo-1/.port/trees/demo-2'
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue({
      path: nestedPath,
      branch: 'demo-2',
      isMain: false,
    })

    await remove('demo-2', { force: true })

    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.removeWorktreeAtPath).toHaveBeenCalledWith('/repo', nestedPath, true)
  })

  test('keeps branch when --keep-branch is set', async () => {
    await remove('demo-2', { keepBranch: true })

    expect(mocks.archiveBranch).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })

  test('prunes stale worktree metadata when path is missing', async () => {
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue({
      path: '/repo/.port/trees/demo-2',
      branch: 'demo-2',
      isMain: false,
    })
    mocks.existsSync.mockReturnValue(false)

    await remove('demo-2', { force: true })

    expect(mocks.runCompose).not.toHaveBeenCalled()
    expect(mocks.pruneWorktrees).toHaveBeenCalledWith('/repo')
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.removeWorktreeAtPath).not.toHaveBeenCalled()
  })

  test('throws a CLI error when not in a git repository', async () => {
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    await expect(remove('demo-2')).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Not in a git repository')
  })

  test('throws a CLI error when worktree is missing', async () => {
    mocks.worktreeExists.mockReturnValue(false)
    mocks.findWorktreeByBranch.mockResolvedValue(null)

    await expect(remove('demo-2')).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Worktree not found: demo-2')
  })

  test('exits worktree before removing when user is inside it', async () => {
    process.env.PORT_WORKTREE = 'demo-2'

    await remove('demo-2')

    expect(mocks.exit).toHaveBeenCalled()
    // Verify exit was called before worktree removal
    const exitOrder = mocks.exit.mock.invocationCallOrder[0]!
    const removeOrder = mocks.removeWorktree.mock.invocationCallOrder[0]!
    expect(exitOrder).toBeLessThan(removeOrder)

    // Verify the rest of the removal still completes
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })

  test('does not exit when user is not inside the target worktree', async () => {
    delete process.env.PORT_WORKTREE

    await remove('demo-2')

    expect(mocks.exit).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
  })
})

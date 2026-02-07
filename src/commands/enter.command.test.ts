import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  getWorktreePath: vi.fn(),
  worktreeExists: vi.fn(),
  loadConfig: vi.fn(),
  configExists: vi.fn(),
  getTreesDir: vi.fn(),
  getComposeFile: vi.fn(),
  branchExists: vi.fn(),
  createWorktree: vi.fn(),
  remoteBranchExists: vi.fn(),
  removeWorktree: vi.fn(),
  writeOverrideFile: vi.fn(),
  parseComposeFile: vi.fn(),
  getProjectName: vi.fn(),
  hookExists: vi.fn(),
  runPostCreateHook: vi.fn(),
  prompt: vi.fn(),
  findSimilarCommand: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
  branch: vi.fn(),
  command: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
  getWorktreePath: mocks.getWorktreePath,
  worktreeExists: mocks.worktreeExists,
}))

vi.mock('../lib/config.ts', () => ({
  loadConfig: mocks.loadConfig,
  configExists: mocks.configExists,
  getTreesDir: mocks.getTreesDir,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/git.ts', () => ({
  branchExists: mocks.branchExists,
  createWorktree: mocks.createWorktree,
  remoteBranchExists: mocks.remoteBranchExists,
  removeWorktree: mocks.removeWorktree,
}))

vi.mock('../lib/compose.ts', () => ({
  writeOverrideFile: mocks.writeOverrideFile,
  parseComposeFile: mocks.parseComposeFile,
  getProjectName: mocks.getProjectName,
}))

vi.mock('../lib/hooks.ts', () => ({
  hookExists: mocks.hookExists,
  runPostCreateHook: mocks.runPostCreateHook,
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
  },
}))

vi.mock('../lib/commands.ts', () => ({
  findSimilarCommand: mocks.findSimilarCommand,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  warn: mocks.warn,
  error: mocks.error,
  info: mocks.info,
  dim: mocks.dim,
  newline: mocks.newline,
  branch: mocks.branch,
  command: mocks.command,
}))

import { enter } from './enter.ts'

describe('enter typo confirmation', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  const originalIsTTY = process.stdin.isTTY

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
    mocks.getTreesDir.mockReturnValue('/tmp')
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.worktreeExists.mockReturnValue(false)
    mocks.branchExists.mockResolvedValue(false)
    mocks.remoteBranchExists.mockResolvedValue(false)
    mocks.findSimilarCommand.mockReturnValue({ command: 'install', distance: 1, similarity: 0.86 })
    mocks.createWorktree.mockResolvedValue('/repo/.port/trees/instal')
    mocks.hookExists.mockResolvedValue(false)
    mocks.parseComposeFile.mockRejectedValue(new Error('compose missing'))
    mocks.getProjectName.mockReturnValue('repo-instal')
    mocks.branch.mockImplementation((value: string) => value)
    mocks.command.mockImplementation((value: string) => value)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    exitSpy.mockRestore()
  })

  test('cancels creation when the user rejects typo confirmation', async () => {
    mocks.prompt.mockResolvedValue({ createBranch: false })

    await expect(enter('instal', { noShell: true })).rejects.toThrow('process.exit:1')

    expect(mocks.prompt).toHaveBeenCalledWith([
      {
        type: 'confirm',
        name: 'createBranch',
        message: 'Create new branch "instal" anyway?',
        default: false,
      },
    ])
    expect(mocks.createWorktree).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith(
      "Cancelled. Run 'port install' if you meant the command."
    )
  })

  test('creates worktree when the user confirms typo warning', async () => {
    mocks.prompt.mockResolvedValue({ createBranch: true })

    await enter('instal', { noShell: true })

    expect(mocks.prompt).toHaveBeenCalledTimes(1)
    expect(mocks.createWorktree).toHaveBeenCalledWith('/repo', 'instal')
  })
})

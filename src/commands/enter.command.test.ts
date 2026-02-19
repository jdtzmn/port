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
  spawn: vi.fn(),
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

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
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
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  const originalIsTTY = process.stdin.isTTY
  const originalArgv = process.argv

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
    process.argv = ['/usr/local/bin/bun', '/repo/dist/index.js', 'instal']

    mocks.spawn.mockImplementation(() => ({
      on: (event: string, handler: (code?: number) => void) => {
        if (event === 'exit') {
          handler(0)
        }
      },
    }))

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    process.argv = originalArgv
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
  })

  test('cancels creation when the user rejects typo confirmation', async () => {
    mocks.prompt
      .mockResolvedValueOnce({ createBranch: false })
      .mockResolvedValueOnce({ runSuggestedCommand: false })

    await expect(enter('instal')).rejects.toThrow('process.exit:1')

    expect(mocks.prompt).toHaveBeenCalledWith([
      {
        type: 'confirm',
        name: 'createBranch',
        message: 'Create new branch "instal" anyway?',
        default: false,
      },
    ])
    expect(mocks.prompt).toHaveBeenCalledWith([
      {
        type: 'confirm',
        name: 'runSuggestedCommand',
        message: 'Run "port install" instead?',
        default: true,
      },
    ])
    expect(mocks.createWorktree).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith('Cancelled.')
  })

  test('creates worktree when the user confirms typo warning', async () => {
    mocks.prompt.mockResolvedValue({ createBranch: true })

    await enter('instal')

    expect(mocks.prompt).toHaveBeenCalledTimes(1)
    expect(mocks.createWorktree).toHaveBeenCalledWith('/repo', 'instal')
  })

  test('runs suggested command with forwarded flags when the user confirms', async () => {
    process.argv = [
      '/usr/local/bin/bun',
      '/repo/dist/index.js',
      'instal',
      '--yes',
      '--domain',
      'dev',
    ]
    mocks.prompt
      .mockResolvedValueOnce({ createBranch: false })
      .mockResolvedValueOnce({ runSuggestedCommand: true })

    await expect(enter('instal')).rejects.toThrow('process.exit:0')

    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/repo/dist/index.js', 'install', '--yes', '--domain', 'dev'],
      expect.objectContaining({
        stdio: 'inherit',
        env: process.env,
      })
    )
  })

  test('supports explicit enter for branch names that match commands', async () => {
    mocks.findSimilarCommand.mockReturnValue({ command: 'status', distance: 0, similarity: 1 })
    mocks.branchExists.mockResolvedValue(true)
    mocks.createWorktree.mockResolvedValue('/repo/.port/trees/status')

    await enter('status')

    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.createWorktree).toHaveBeenCalledWith('/repo', 'status')
  })
})

describe('enter --shell-helper', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn>

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
    mocks.worktreeExists.mockReturnValue(true)
    mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/feature-1')
    mocks.hookExists.mockResolvedValue(false)
    mocks.parseComposeFile.mockRejectedValue(new Error('compose missing'))
    mocks.getProjectName.mockReturnValue('repo-feature-1')
    mocks.branch.mockImplementation((value: string) => value)
    mocks.command.mockImplementation((value: string) => value)

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
  })

  test('outputs bash shell commands when --shell-helper is bash', async () => {
    await enter('feature-1', { shellHelper: 'bash' })

    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    const output = stdoutSpy.mock.calls[0][0] as string

    expect(output).toContain("cd -- '/repo/.port/trees/feature-1'")
    expect(output).toContain("export PORT_WORKTREE='feature-1'")
    expect(output).toContain("export PORT_REPO='/repo'")
  })

  test('outputs fish shell commands when --shell-helper is fish', async () => {
    await enter('feature-1', { shellHelper: 'fish' })

    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    const output = stdoutSpy.mock.calls[0][0] as string

    expect(output).toContain("builtin cd '/repo/.port/trees/feature-1'")
    expect(output).toContain("set -gx PORT_WORKTREE 'feature-1'")
    expect(output).toContain("set -gx PORT_REPO '/repo'")
  })

  test('defaults to bash when --shell-helper is boolean true (backward compat)', async () => {
    await enter('feature-1', { shellHelper: true })

    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    const output = stdoutSpy.mock.calls[0][0] as string

    expect(output).toContain("cd -- '/repo/.port/trees/feature-1'")
    expect(output).toContain("export PORT_WORKTREE='feature-1'")
    expect(output).toContain("export PORT_REPO='/repo'")
  })

  test('does not output shell commands without --shell-helper', async () => {
    await enter('feature-1')

    expect(stdoutSpy).not.toHaveBeenCalled()
    // Should print human-readable hints instead
    expect(mocks.info).toHaveBeenCalledWith('Run: cd /repo/.port/trees/feature-1')
  })

  test('prints shell integration hint without --shell-helper', async () => {
    await enter('feature-1')

    expect(mocks.dim).toHaveBeenCalledWith(expect.stringContaining('port shell-hook'))
  })
})

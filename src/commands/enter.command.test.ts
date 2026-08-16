import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  getWorktreePath: vi.fn(),
  worktreeExists: vi.fn(),
  loadConfigOrDefault: vi.fn(),
  ensurePortRuntimeDir: vi.fn(),
  getTreesDir: vi.fn(),
  getComposeFile: vi.fn(),
  branchExists: vi.fn(),
  createWorktree: vi.fn(),
  remoteBranchExists: vi.fn(),
  removeWorktree: vi.fn(),
  parseDuplicateWorktreeError: vi.fn(),
  resolveBranchRef: vi.fn(),
  writeOverrideFile: vi.fn(),
  parseComposeFile: vi.fn(),
  buildProjectName: vi.fn(),
  hookExists: vi.fn(),
  runPostCreateHook: vi.fn(),
  prompt: vi.fn(),
  spawn: vi.fn(),
  findSimilarCommand: vi.fn(),
  writeEvalFile: vi.fn(),
  getStaleWorktreeCandidates: vi.fn(),
  STALE_WORKTREE_EXTREME_THRESHOLD: 25,
  formatStaleWorktreeWarning: vi.fn(),
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
  loadConfigOrDefault: mocks.loadConfigOrDefault,
  ensurePortRuntimeDir: mocks.ensurePortRuntimeDir,
  getTreesDir: mocks.getTreesDir,
  getComposeFile: mocks.getComposeFile,
}))

vi.mock('../lib/git.ts', () => ({
  branchExists: mocks.branchExists,
  createWorktree: mocks.createWorktree,
  remoteBranchExists: mocks.remoteBranchExists,
  removeWorktree: mocks.removeWorktree,
  parseDuplicateWorktreeError: mocks.parseDuplicateWorktreeError,
  resolveBranchRef: mocks.resolveBranchRef,
}))

vi.mock('../lib/compose.ts', () => ({
  writeOverrideFile: mocks.writeOverrideFile,
  parseComposeFile: mocks.parseComposeFile,
}))

vi.mock('../lib/projectName.ts', () => ({
  buildProjectName: mocks.buildProjectName,
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

vi.mock('../lib/staleWorktrees.ts', () => ({
  getStaleWorktreeCandidates: mocks.getStaleWorktreeCandidates,
  STALE_WORKTREE_EXTREME_THRESHOLD: mocks.STALE_WORKTREE_EXTREME_THRESHOLD,
  formatStaleWorktreeWarning: mocks.formatStaleWorktreeWarning,
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

vi.mock('../lib/shell.ts', async () => {
  const actual = await vi.importActual<typeof import('../lib/shell.ts')>('../lib/shell.ts')
  return {
    ...actual,
    writeEvalFile: mocks.writeEvalFile,
  }
})

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
    mocks.ensurePortRuntimeDir.mockResolvedValue(undefined)
    mocks.loadConfigOrDefault.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getTreesDir.mockReturnValue('/tmp')
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.worktreeExists.mockReturnValue(false)
    mocks.branchExists.mockResolvedValue(false)
    mocks.remoteBranchExists.mockResolvedValue(false)
    mocks.resolveBranchRef.mockImplementation(async (_repoRoot: string, branch: string) => branch)
    mocks.findSimilarCommand.mockReturnValue({ command: 'install', distance: 1, similarity: 0.86 })
    mocks.createWorktree.mockResolvedValue('/repo/.port/trees/instal')
    mocks.parseDuplicateWorktreeError.mockReturnValue(null)
    mocks.hookExists.mockResolvedValue(false)
    mocks.parseComposeFile.mockRejectedValue(new Error('compose missing'))
    mocks.buildProjectName.mockReturnValue('repo-instal')
    mocks.getStaleWorktreeCandidates.mockResolvedValue([])
    mocks.formatStaleWorktreeWarning.mockImplementation(
      (count: number) => `You have ${count} stale port worktrees. Consider running port prune.`
    )
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

  test('resolves spaced branch names to a valid ref for existence checks', async () => {
    // "my feature" is not a valid git ref; it resolves to "my-feature".
    mocks.findSimilarCommand.mockReturnValue(null)
    mocks.resolveBranchRef.mockResolvedValue('my-feature')
    mocks.createWorktree.mockResolvedValue('/repo/.port/trees/my-feature')

    await enter('my feature')

    // The raw name is resolved to a valid ref...
    expect(mocks.resolveBranchRef).toHaveBeenCalledWith('/repo', 'my feature')
    // ...and existence checks use the resolved ref, not the raw spaced name.
    expect(mocks.branchExists).toHaveBeenCalledWith('/repo', 'my-feature')
    // createWorktree receives the raw branch (it sanitizes the dir + resolves
    // the ref internally).
    expect(mocks.createWorktree).toHaveBeenCalledWith('/repo', 'my feature')
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  function mockDuplicateWorktree(): void {
    mocks.branchExists.mockResolvedValue(true)
    mocks.createWorktree.mockRejectedValueOnce(
      new Error(
        "fatal: 'shared' is already used by worktree at '/repo/.port/trees/shared-external'"
      )
    )
    mocks.parseDuplicateWorktreeError.mockReturnValue({
      branch: 'shared',
      path: '/repo/.port/trees/shared-external',
    })
    mocks.parseComposeFile.mockResolvedValue({ services: {} })
    mocks.buildProjectName.mockReturnValue('repo-shared')
  }

  test('offers to enter the existing worktree when the branch is already checked out', async () => {
    mockDuplicateWorktree()
    mocks.prompt.mockResolvedValueOnce({ useExistingWorktree: true })

    await enter('shared')

    expect(mocks.parseDuplicateWorktreeError).toHaveBeenCalledWith(expect.any(Error))
    expect(mocks.warn).toHaveBeenCalledWith(
      'Branch "shared" is already checked out in another worktree at /repo/.port/trees/shared-external'
    )
    expect(mocks.prompt).toHaveBeenCalledWith([
      {
        type: 'confirm',
        name: 'useExistingWorktree',
        message: 'Enter that worktree instead?',
        default: true,
      },
    ])
    expect(mocks.writeOverrideFile).toHaveBeenCalledWith(
      '/repo/.port/trees/shared-external',
      { services: {} },
      'shared',
      'port',
      'repo-shared'
    )
    expect(mocks.createWorktree).toHaveBeenCalledWith('/repo', 'shared')
    // The summary names the reused directory, which differs from the branch.
    expect(mocks.success).toHaveBeenCalledWith(
      'Using existing worktree: shared-external (branch shared)'
    )
  })

  test('cancels when the user declines to enter the existing worktree', async () => {
    mockDuplicateWorktree()
    mocks.prompt.mockResolvedValueOnce({ useExistingWorktree: false })

    await expect(enter('shared')).rejects.toThrow('process.exit:1')

    expect(mocks.info).toHaveBeenCalledWith('Cancelled.')
    expect(mocks.writeOverrideFile).not.toHaveBeenCalled()
  })

  test('reuses the existing worktree without prompting in non-interactive terminals', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    mockDuplicateWorktree()

    await enter('shared')

    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      'Branch "shared" is already checked out in another worktree; using /repo/.port/trees/shared-external'
    )
    expect(mocks.writeOverrideFile).toHaveBeenCalledWith(
      '/repo/.port/trees/shared-external',
      { services: {} },
      'shared',
      'port',
      'repo-shared'
    )
    expect(mocks.success).toHaveBeenCalledWith(
      'Using existing worktree: shared-external (branch shared)'
    )
  })

  test('warns when creating a new worktree and the stale count is extreme', async () => {
    mocks.getStaleWorktreeCandidates.mockResolvedValue([
      { branch: 'feature-a', sanitized: 'feature-a', reason: 'merged' },
      { branch: 'feature-b', sanitized: 'feature-b', reason: 'gone' },
      { branch: 'feature-c', sanitized: 'feature-c', reason: 'pr-merged' },
      { branch: 'feature-d', sanitized: 'feature-d', reason: 'merged' },
      { branch: 'feature-e', sanitized: 'feature-e', reason: 'gone' },
      { branch: 'feature-f', sanitized: 'feature-f', reason: 'merged' },
      { branch: 'feature-g', sanitized: 'feature-g', reason: 'merged' },
      { branch: 'feature-h', sanitized: 'feature-h', reason: 'merged' },
      { branch: 'feature-i', sanitized: 'feature-i', reason: 'merged' },
      { branch: 'feature-j', sanitized: 'feature-j', reason: 'merged' },
      { branch: 'feature-k', sanitized: 'feature-k', reason: 'merged' },
      { branch: 'feature-l', sanitized: 'feature-l', reason: 'merged' },
      { branch: 'feature-m', sanitized: 'feature-m', reason: 'merged' },
      { branch: 'feature-n', sanitized: 'feature-n', reason: 'merged' },
      { branch: 'feature-o', sanitized: 'feature-o', reason: 'merged' },
      { branch: 'feature-p', sanitized: 'feature-p', reason: 'merged' },
      { branch: 'feature-q', sanitized: 'feature-q', reason: 'merged' },
      { branch: 'feature-r', sanitized: 'feature-r', reason: 'merged' },
      { branch: 'feature-s', sanitized: 'feature-s', reason: 'merged' },
      { branch: 'feature-t', sanitized: 'feature-t', reason: 'merged' },
      { branch: 'feature-u', sanitized: 'feature-u', reason: 'merged' },
      { branch: 'feature-v', sanitized: 'feature-v', reason: 'merged' },
      { branch: 'feature-w', sanitized: 'feature-w', reason: 'merged' },
      { branch: 'feature-x', sanitized: 'feature-x', reason: 'merged' },
      { branch: 'feature-y', sanitized: 'feature-y', reason: 'merged' },
    ])

    await enter('new-feature')

    expect(mocks.warn).toHaveBeenCalledWith(
      'You have 25 stale port worktrees. Consider running port prune.'
    )
    expect(mocks.createWorktree).toHaveBeenCalledWith('/repo', 'new-feature')
  })
})

describe('enter with shell hook eval file', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  const originalEnv = { ...process.env }

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
    mocks.getTreesDir.mockReturnValue('/tmp')
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.worktreeExists.mockReturnValue(true)
    mocks.getWorktreePath.mockReturnValue('/repo/.port/trees/feature-1')
    mocks.hookExists.mockResolvedValue(false)
    mocks.parseComposeFile.mockRejectedValue(new Error('compose missing'))
    mocks.buildProjectName.mockReturnValue('repo-feature-1')
    mocks.resolveBranchRef.mockImplementation(async (_repoRoot: string, branch: string) => branch)
    mocks.branch.mockImplementation((value: string) => value)
    mocks.command.mockImplementation((value: string) => value)

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${typeof code === 'number' ? code : 0}`)
    })

    delete process.env.__PORT_EVAL
    delete process.env.__PORT_SHELL
  })

  afterEach(() => {
    exitSpy.mockRestore()
    process.env = { ...originalEnv }
  })

  test('writes bash shell commands to eval file', async () => {
    process.env.__PORT_EVAL = '/tmp/test-eval'
    process.env.__PORT_SHELL = 'bash'

    await enter('feature-1')

    expect(mocks.writeEvalFile).toHaveBeenCalledTimes(1)
    const commands = mocks.writeEvalFile.mock.calls[0]![0] as string

    expect(commands).toContain("cd -- '/repo/.port/trees/feature-1'")
    expect(commands).toContain("export PORT_WORKTREE='feature-1'")
    expect(commands).toContain("export PORT_REPO='/repo'")
  })

  test('writes fish shell commands to eval file', async () => {
    process.env.__PORT_EVAL = '/tmp/test-eval'
    process.env.__PORT_SHELL = 'fish'

    await enter('feature-1')

    expect(mocks.writeEvalFile).toHaveBeenCalledTimes(1)
    const commands = mocks.writeEvalFile.mock.calls[0]![0] as string

    expect(commands).toContain("builtin cd '/repo/.port/trees/feature-1'")
    expect(commands).toContain("set -gx PORT_WORKTREE 'feature-1'")
    expect(commands).toContain("set -gx PORT_REPO '/repo'")
  })

  test('does not write eval file without __PORT_EVAL', async () => {
    await enter('feature-1')

    expect(mocks.writeEvalFile).not.toHaveBeenCalled()
    // Should print human-readable hints instead
    expect(mocks.info).toHaveBeenCalledWith('Run: cd /repo/.port/trees/feature-1')
  })

  test('prints shell integration hint without shell hook', async () => {
    await enter('feature-1')

    expect(mocks.dim).toHaveBeenCalledWith(expect.stringContaining('port shell-hook'))
  })

  test('summarizes a newly created worktree by branch name', async () => {
    await enter('feature-1')

    expect(mocks.success).toHaveBeenCalledWith('Worktree ready: feature-1')
    expect(mocks.success).not.toHaveBeenCalledWith(
      expect.stringContaining('Using existing worktree')
    )
  })
})

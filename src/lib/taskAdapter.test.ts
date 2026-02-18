import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createWorktree: vi.fn(),
  removeWorktreeAtPath: vi.fn(),
  deleteLocalBranch: vi.fn(),
  spawn: vi.fn(),
  processKill: vi.fn(),
  existsSync: vi.fn(),
}))

vi.mock('./git.ts', () => ({
  createWorktree: mocks.createWorktree,
  removeWorktreeAtPath: mocks.removeWorktreeAtPath,
  deleteLocalBranch: mocks.deleteLocalBranch,
}))

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}))

vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: mocks.existsSync,
  }
})

import { LocalTaskExecutionAdapter, buildOpenCodeContinuePlan } from './taskAdapter.ts'

describe('LocalTaskExecutionAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.processKill.mockReset()
    mocks.existsSync.mockReturnValue(true)
    vi.spyOn(process, 'kill').mockImplementation(
      mocks.processKill as unknown as typeof process.kill
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('prepares an ephemeral worktree for a task', async () => {
    mocks.createWorktree.mockResolvedValue('/repo/.port/trees/port-task-task-1234')
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')

    const prepared = await adapter.prepare('/repo', {
      id: 'task-1234',
      displayId: 1,
      title: 'demo',
      mode: 'write',
      status: 'queued',
      adapter: 'local',
      capabilities: {
        supportsAttachHandoff: false,
        supportsResumeToken: false,
        supportsTranscript: false,
        supportsFailedSnapshot: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    expect(mocks.createWorktree).toHaveBeenCalledWith('/repo', 'port-task-task-1234')
    expect(prepared.worktreePath).toContain('port-task-task-1234')
  })

  test('starts worker process and returns pid-backed handle', async () => {
    mocks.spawn.mockReturnValue({ pid: 4321 })
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')

    const handle = await adapter.start(
      '/repo',
      {
        id: 'task-1234',
        displayId: 1,
        title: 'demo',
        mode: 'write',
        status: 'queued',
        adapter: 'local',
        capabilities: {
          supportsAttachHandoff: false,
          supportsResumeToken: false,
          supportsTranscript: false,
          supportsFailedSnapshot: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        taskId: 'task-1234',
        runId: 'run-1',
        branch: 'port-task-task-1234',
        worktreePath: '/repo/.port/trees/port-task-task-1234',
      }
    )

    expect(handle.workerPid).toBe(4321)
    expect(mocks.spawn).toHaveBeenCalled()
  })

  test('checkpoints and restores a worker from saved checkpoint', async () => {
    mocks.spawn.mockReturnValue({ pid: 9876 })
    mocks.processKill.mockImplementation((_pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) {
        throw new Error('not running')
      }
      return true
    })

    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const checkpoint = await adapter.checkpoint({
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 1111,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    })

    expect(checkpoint.payload.opencode?.fallbackSummary).toContain('Continue task task-1234')

    const restored = await adapter.restore(
      '/repo',
      {
        id: 'task-1234',
        displayId: 1,
        title: 'demo',
        mode: 'write',
        status: 'resuming',
        adapter: 'local',
        capabilities: {
          supportsAttachHandoff: false,
          supportsResumeToken: false,
          supportsTranscript: false,
          supportsFailedSnapshot: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      checkpoint
    )

    expect(restored.workerPid).toBe(9876)
    expect(mocks.spawn).toHaveBeenCalled()
  })

  test('builds native OpenCode continue plan when checkpoint has session metadata', () => {
    const plan = buildOpenCodeContinuePlan('/repo', {
      adapterId: 'local',
      taskId: 'task-1234',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      payload: {
        workerPid: 123,
        worktreePath: '/repo/.port/trees/port-task-task-1234',
        branch: 'port-task-task-1234',
        opencode: {
          sessionId: 'oc-session-1',
          transcriptPath: '/repo/.port/jobs/artifacts/task-1234/attach/io.log',
          workspaceRef: '/repo/.port/trees/port-task-task-1234',
          fallbackSummary: 'resume task from summary',
        },
      },
    })

    expect(plan.strategy).toBe('native_session')
    expect(plan.command).toBe('opencode')
    expect(plan.args).toEqual(['--continue', 'oc-session-1'])
    expect(plan.workspaceRef).toBe('/repo/.port/trees/port-task-task-1234')
    expect(plan.transcriptPath).toBe('/repo/.port/jobs/artifacts/task-1234/attach/io.log')
  })

  test('builds fallback OpenCode continue plan when session metadata is missing', () => {
    const plan = buildOpenCodeContinuePlan('/repo', {
      adapterId: 'local',
      taskId: 'task-1234',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      payload: {
        workerPid: 123,
        worktreePath: '/repo/.port/trees/port-task-task-1234',
        branch: 'port-task-task-1234',
      },
    })

    expect(plan.strategy).toBe('fallback_summary')
    expect(plan.command).toBe('opencode')
    expect(plan.args).toEqual([])
    expect(plan.summary).toContain('Continue task task-1234 from run run-1.')
    expect(plan.summary).toContain('.port/jobs/artifacts/task-1234')
  })

  test('local adapter reports attach-capable with correct capability flags', () => {
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')

    expect(adapter.capabilities.supportsCheckpoint).toBe(true)
    expect(adapter.capabilities.supportsRestore).toBe(true)
    expect(adapter.capabilities.supportsAttachHandoff).toBe(true)
    expect(adapter.capabilities.supportsResumeToken).toBe(false)
    expect(adapter.capabilities.supportsTranscript).toBe(false)
    expect(adapter.capabilities.supportsFailedSnapshot).toBe(false)
  })

  test('requestHandoff returns immediate boundary for running worker', async () => {
    mocks.processKill.mockReturnValue(true)
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 123,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    }

    const result = await adapter.requestHandoff(handle)

    expect(result.boundary).toBe('immediate')
    expect(result.sessionHandle).toBe('run-1')
    expect(result.readyAt).toBeTruthy()
    expect(() => new Date(result.readyAt).toISOString()).not.toThrow()
  })

  test('requestHandoff returns immediate boundary even for exited worker', async () => {
    mocks.processKill.mockImplementation(() => {
      throw new Error('not running')
    })
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 999,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    }

    const result = await adapter.requestHandoff(handle)

    expect(result.boundary).toBe('immediate')
    expect(result.sessionHandle).toBe('run-1')
  })

  test('attachContext returns native_session strategy when opencode sessionId is present', async () => {
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 123,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
      opencode: {
        sessionId: 'oc-session-1',
        transcriptPath: '/repo/.port/jobs/artifacts/task-1234/attach/io.log',
        workspaceRef: '/repo/.port/trees/port-task-task-1234',
        fallbackSummary: 'resume task from summary',
      },
    }

    const context = await adapter.attachContext(handle)

    expect(context.sessionHandle).toBe('run-1')
    expect(context.restoreStrategy).toBe('native_session')
    expect(context.workspaceRef).toBe('/repo/.port/trees/port-task-task-1234')
    expect(context.transcriptPath).toBe('/repo/.port/jobs/artifacts/task-1234/attach/io.log')
    expect(context.summary).toBe('resume task from summary')
    expect(context.checkpointRunId).toBe('run-1')
    expect(context.checkpointCreatedAt).toBeTruthy()
  })

  test('attachContext returns fallback_summary strategy when opencode sessionId is absent', async () => {
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 123,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    }

    const context = await adapter.attachContext(handle)

    expect(context.restoreStrategy).toBe('fallback_summary')
    expect(context.summary).toContain('Continue task task-1234')
    expect(context.transcriptPath).toBeUndefined()
  })

  test('attachContext omits resumeToken for local adapter', async () => {
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 123,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    }

    const context = await adapter.attachContext(handle)

    expect(context.resumeToken).toBeUndefined()
  })

  test('resumeFromAttach resolves without error for running worker', async () => {
    mocks.processKill.mockReturnValue(true)
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 123,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    }

    await expect(adapter.resumeFromAttach(handle)).resolves.toBeUndefined()
  })

  test('resumeFromAttach resolves without error for exited worker', async () => {
    mocks.processKill.mockImplementation(() => {
      throw new Error('not running')
    })
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')
    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 999,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    }

    await expect(adapter.resumeFromAttach(handle)).resolves.toBeUndefined()
  })

  test('cancels running worker and cleans up worktree', async () => {
    const adapter = new LocalTaskExecutionAdapter('/repo/src/index.ts')

    const handle = {
      taskId: 'task-1234',
      runId: 'run-1',
      workerPid: 4321,
      worktreePath: '/repo/.port/trees/port-task-task-1234',
      branch: 'port-task-task-1234',
    }

    mocks.processKill.mockImplementation((_pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0 || signal === 'SIGTERM') {
        return true
      }
      throw new Error('unexpected signal')
    })

    await adapter.cancel(handle)
    await adapter.cleanup('/repo', handle)

    expect(mocks.removeWorktreeAtPath).toHaveBeenCalledWith('/repo', handle.worktreePath, true)
    expect(mocks.deleteLocalBranch).toHaveBeenCalledWith('/repo', handle.branch, true)
  })
})

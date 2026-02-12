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

import { LocalTaskExecutionAdapter } from './taskAdapter.ts'

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

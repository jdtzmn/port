import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  createTask: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  readTaskEvents: vi.fn(),
  isTerminalTaskStatus: vi.fn(),
  patchTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  ensureTaskDaemon: vi.fn(),
  runTaskDaemon: vi.fn(),
  stopTaskDaemon: vi.fn(),
  cleanupTaskRuntime: vi.fn(),
  execFileAsync: vi.fn(),
  appendTaskStdout: vi.fn(),
  appendTaskStderr: vi.fn(),
  writeTaskCommitRefs: vi.fn(),
  writeTaskPatchFromWorktree: vi.fn(),
  writeTaskMetadata: vi.fn(),
  readTaskCommitRefs: vi.fn(),
  hasTaskBundle: vi.fn(),
  getTaskBundlePath: vi.fn(),
  getTaskPatchPath: vi.fn(),
  getTaskStdoutPath: vi.fn(),
  getTaskStderrPath: vi.fn(),
  listTaskArtifactPaths: vi.fn(),
  readGlobalTaskEvents: vi.fn(),
  consumeGlobalTaskEvents: vi.fn(),
  resolveTaskAdapter: vi.fn(),
  resolveTaskRef: vi.fn(),
  success: vi.fn(),
  dim: vi.fn(),
  info: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  error: vi.fn(),
  branch: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/taskStore.ts', () => ({
  createTask: mocks.createTask,
  listTasks: mocks.listTasks,
  getTask: mocks.getTask,
  readTaskEvents: mocks.readTaskEvents,
  isTerminalTaskStatus: mocks.isTerminalTaskStatus,
  patchTask: mocks.patchTask,
  updateTaskStatus: mocks.updateTaskStatus,
}))

vi.mock('../lib/exec.ts', () => ({
  execFileAsync: mocks.execFileAsync,
}))

vi.mock('../lib/taskArtifacts.ts', () => ({
  appendTaskStdout: mocks.appendTaskStdout,
  appendTaskStderr: mocks.appendTaskStderr,
  writeTaskCommitRefs: mocks.writeTaskCommitRefs,
  writeTaskPatchFromWorktree: mocks.writeTaskPatchFromWorktree,
  writeTaskMetadata: mocks.writeTaskMetadata,
  readTaskCommitRefs: mocks.readTaskCommitRefs,
  hasTaskBundle: mocks.hasTaskBundle,
  getTaskBundlePath: mocks.getTaskBundlePath,
  getTaskPatchPath: mocks.getTaskPatchPath,
  getTaskStdoutPath: mocks.getTaskStdoutPath,
  getTaskStderrPath: mocks.getTaskStderrPath,
  listTaskArtifactPaths: mocks.listTaskArtifactPaths,
}))

vi.mock('../lib/taskEventStream.ts', () => ({
  readGlobalTaskEvents: mocks.readGlobalTaskEvents,
  consumeGlobalTaskEvents: mocks.consumeGlobalTaskEvents,
}))

vi.mock('../lib/taskAdapterRegistry.ts', () => ({
  resolveTaskAdapter: mocks.resolveTaskAdapter,
}))

vi.mock('../lib/taskId.ts', () => ({
  resolveTaskRef: mocks.resolveTaskRef,
}))

vi.mock('../lib/taskDaemon.ts', () => ({
  ensureTaskDaemon: mocks.ensureTaskDaemon,
  runTaskDaemon: mocks.runTaskDaemon,
  stopTaskDaemon: mocks.stopTaskDaemon,
  cleanupTaskRuntime: mocks.cleanupTaskRuntime,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  dim: mocks.dim,
  info: mocks.info,
  header: mocks.header,
  newline: mocks.newline,
  error: mocks.error,
  branch: mocks.branch,
}))

import {
  taskApply,
  taskAttach,
  taskArtifacts,
  taskCancel,
  taskCleanup,
  taskDaemon,
  taskList,
  taskLogs,
  taskRead,
  taskResume,
  taskStart,
  taskWait,
  taskWatch,
  taskEvents,
  taskWorker,
} from './task.ts'

describe('task command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.branch.mockImplementation((value: string) => value)
    mocks.getTaskPatchPath.mockReturnValue('/repo/.port/jobs/artifacts/task-1/changes.patch')
    mocks.getTaskBundlePath.mockReturnValue('/repo/.port/jobs/artifacts/task-1/changes.bundle')
    mocks.getTaskStdoutPath.mockReturnValue('/repo/.port/jobs/artifacts/task-1/stdout.log')
    mocks.getTaskStderrPath.mockReturnValue('/repo/.port/jobs/artifacts/task-1/stderr.log')
    mocks.listTaskArtifactPaths.mockReturnValue(['/repo/.port/jobs/artifacts/task-1/metadata.json'])
    mocks.hasTaskBundle.mockReturnValue(false)
    mocks.isTerminalTaskStatus.mockReturnValue(false)
    mocks.resolveTaskRef.mockImplementation(async (_repo: string, ref: string) => {
      const tasks = [
        {
          id: 'task-1',
          displayId: 1,
          title: 'demo',
          mode: 'write',
          status: 'queued',
          adapter: 'local',
          capabilities: {
            supportsCheckpoint: false,
            supportsRestore: false,
            supportsAttachHandoff: false,
            supportsResumeToken: false,
            supportsTranscript: false,
            supportsFailedSnapshot: false,
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]

      const task =
        ref === '1'
          ? tasks[0]
          : tasks.find(
              item => item.id === ref || item.id.startsWith(ref) || item.id === `task-${ref}`
            )

      if (!task) {
        return { ok: false, kind: 'not_found', ref }
      }

      return { ok: true, task, matchedBy: ref === '1' ? 'display_id' : 'canonical_id' }
    })
    mocks.readTaskEvents.mockResolvedValue([])
    mocks.readGlobalTaskEvents.mockResolvedValue({ events: [], nextLine: 0 })
    mocks.consumeGlobalTaskEvents.mockResolvedValue(0)
    mocks.resolveTaskAdapter.mockResolvedValue({
      adapter: {
        id: 'local',
        capabilities: {
          supportsCheckpoint: true,
          supportsRestore: true,
          supportsAttachHandoff: true,
        },
        restore: vi.fn().mockResolvedValue({
          taskId: 'task-1',
          runId: 'run-2',
          workerPid: 777,
          worktreePath: '/repo/.port/trees/port-task-task-1',
          branch: 'port-task-task-1',
        }),
        checkpoint: vi.fn().mockResolvedValue({
          adapterId: 'local',
          taskId: 'task-1',
          runId: 'run-2',
          createdAt: '2026-01-01T00:00:00.000Z',
          payload: {
            workerPid: 777,
            worktreePath: '/repo/.port/trees/port-task-task-1',
            branch: 'port-task-task-1',
          },
        }),
        requestHandoff: vi.fn().mockResolvedValue({
          boundary: 'immediate',
          sessionHandle: 'run-2',
          readyAt: '2026-01-01T00:00:01.000Z',
        }),
        attachContext: vi.fn().mockResolvedValue({
          sessionHandle: 'run-2',
          checkpointRunId: 'run-2',
          checkpointCreatedAt: '2026-01-01T00:00:00.000Z',
          workspaceRef: '/repo/.port/trees/port-task-task-1',
          restoreStrategy: 'fallback_summary',
          summary: 'Continue task task-1 from run run-2.',
        }),
        resumeFromAttach: vi.fn(),
      },
      configuredId: 'local',
      resolvedId: 'local',
      fallbackUsed: false,
    })
  })

  test('task start queues a task and ensures daemon', async () => {
    mocks.createTask.mockResolvedValue({
      id: 'task-abc12345',
      displayId: 12,
      mode: 'write',
      title: 'hello',
    })

    await taskStart('hello')

    expect(mocks.createTask).toHaveBeenCalledWith('/repo', {
      title: 'hello',
      mode: undefined,
      branch: undefined,
    })
    expect(mocks.ensureTaskDaemon).toHaveBeenCalledWith('/repo')
    expect(mocks.success).toHaveBeenCalledWith('Queued #12 (write)')
    expect(mocks.dim).toHaveBeenCalledWith('task-abc12345')
  })

  test('task list prints no tasks message when empty', async () => {
    mocks.listTasks.mockResolvedValue([])

    await taskList()

    expect(mocks.info).toHaveBeenCalledWith('No tasks found.')
  })

  test('task read throws cli error when task is missing', async () => {
    mocks.resolveTaskRef.mockResolvedValue({ ok: false, kind: 'not_found', ref: 'task-missing' })

    await expect(taskRead('task-missing')).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith('Task not found: task-missing')
  })

  test('task daemon serve executes run loop', async () => {
    await taskDaemon({ serve: true, repo: '/repo' })

    expect(mocks.runTaskDaemon).toHaveBeenCalledWith('/repo')
  })

  test('task cleanup stops daemon and clears runtime state', async () => {
    mocks.stopTaskDaemon.mockResolvedValue({ stopped: true, reason: 'stopped' })

    await taskCleanup()

    expect(mocks.stopTaskDaemon).toHaveBeenCalledWith('/repo')
    expect(mocks.cleanupTaskRuntime).toHaveBeenCalledWith('/repo')
    expect(mocks.success).toHaveBeenCalledWith('Stopped task daemon')
  })

  test('task artifacts lists artifact paths', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        title: 'done',
      },
    })

    await taskArtifacts('1')

    expect(mocks.header).toHaveBeenCalledWith('Artifacts for #1 (task-1):')
  })

  test('task logs prints log content', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        title: 'done',
      },
    })
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

    await taskLogs('1')

    expect(mocks.getTaskStdoutPath).toHaveBeenCalledWith('/repo', 'task-1')
  })

  test('task wait exits when task is terminal', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: { id: 'task-1', displayId: 1, status: 'completed' },
    })
    mocks.getTask.mockResolvedValue({ id: 'task-1', displayId: 1, status: 'completed' })
    mocks.isTerminalTaskStatus.mockReturnValue(true)

    await taskWait('1')

    expect(mocks.success).toHaveBeenCalledWith('Task #1 (task-1) is completed')
  })

  test('task resume sets resuming status for non-terminal tasks', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: { id: 'task-1', displayId: 1, status: 'running' },
    })
    mocks.isTerminalTaskStatus.mockReturnValue(false)

    await taskResume('1')

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'resuming',
      'Resume requested by user'
    )
    expect(mocks.ensureTaskDaemon).toHaveBeenCalledWith('/repo')
  })

  test('task resume keeps terminal tasks ended', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: { id: 'task-1', displayId: 1, status: 'completed' },
    })
    mocks.isTerminalTaskStatus.mockReturnValue(true)

    await taskResume('1')

    expect(mocks.updateTaskStatus).not.toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'resuming',
      expect.anything()
    )
    expect(mocks.info).toHaveBeenCalledWith(
      'Task #1 (task-1) is terminal (completed); use attach to revive it.'
    )
  })

  test('task cancel marks task cancelled', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        status: 'running',
        runtime: { workerPid: 123 },
      },
    })
    mocks.patchTask.mockResolvedValue(undefined)
    mocks.updateTaskStatus.mockResolvedValue(undefined)

    await taskCancel('1')

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'cancelled',
      'Cancelled by user command'
    )
  })

  test('task watch prints one snapshot in once mode', async () => {
    mocks.listTasks.mockResolvedValue([
      { id: 'task-1', status: 'queued', mode: 'write', title: 'demo' },
    ])

    await taskWatch({ once: true })

    expect(mocks.header).toHaveBeenCalledWith('Task watch:')
  })

  test('task events prints global stream entries', async () => {
    mocks.readGlobalTaskEvents.mockResolvedValue({
      events: [{ at: '2026-01-01', taskId: 'task-1', type: 'task.created', message: 'hello' }],
      nextLine: 1,
    })

    await taskEvents({ follow: false })

    expect(mocks.info).toHaveBeenCalledWith('2026-01-01 task-1 task.created - hello')
  })

  test('task events consumes consumer cursor stream', async () => {
    mocks.consumeGlobalTaskEvents.mockImplementation(async (_repo, _consumer, handler) => {
      await handler({ at: '2026-01-01', taskId: 'task-1', type: 'task.completed', message: 'done' })
      return 1
    })

    await taskEvents({ consumer: 'opencode', follow: false })

    expect(mocks.consumeGlobalTaskEvents).toHaveBeenCalledWith(
      '/repo',
      'opencode',
      expect.any(Function),
      { limit: 500 }
    )
  })

  test('task worker marks completed when execution succeeds', async () => {
    mocks.getTask.mockResolvedValue({ id: 'task-1', title: 'hello', mode: 'write', runtime: {} })
    mocks.updateTaskStatus.mockResolvedValue(undefined)
    mocks.patchTask.mockResolvedValue(undefined)
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

    await taskWorker({ taskId: 'task-1', repo: '/repo', worktree: '/repo/.port/trees/task-1' })

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'running',
      'Worker started'
    )
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'completed',
      'Worker completed successfully'
    )
    expect(mocks.writeTaskCommitRefs).toHaveBeenCalledWith('/repo', 'task-1', [])
    expect(mocks.writeTaskPatchFromWorktree).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      '/repo/.port/trees/task-1'
    )
    expect(mocks.writeTaskMetadata).toHaveBeenCalled()
  })

  test('task worker marks failed when execution throws', async () => {
    mocks.getTask.mockResolvedValue({
      id: 'task-2',
      title: 'boom [fail]',
      mode: 'write',
      runtime: {},
    })
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

    await expect(
      taskWorker({ taskId: 'task-2', repo: '/repo', worktree: '/repo/.port/trees/task-2' })
    ).rejects.toThrow('Task requested failure')

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-2',
      'failed',
      expect.stringContaining('Task requested failure')
    )
  })

  test('task apply uses cherry-pick refs in auto mode', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: { id: 'task-1', displayId: 1, title: 'done', mode: 'write' },
    })
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.readTaskCommitRefs.mockResolvedValue(['abc123'])

    await taskApply('1', { method: 'auto', squash: false })

    expect(mocks.execFileAsync).toHaveBeenCalledWith('git', ['cherry-pick', 'abc123'], {
      cwd: '/repo',
    })
  })

  test('task apply falls back to patch when no refs', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: { id: 'task-1', displayId: 1, title: 'done', mode: 'write' },
    })
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.readTaskCommitRefs.mockResolvedValue([])

    await taskApply('1', { method: 'auto', squash: false })

    expect(mocks.execFileAsync).toHaveBeenCalledWith(
      'git',
      ['apply', '--3way', '/repo/.port/jobs/artifacts/task-1/changes.patch'],
      { cwd: '/repo' }
    )
  })

  test('task attach revives terminal task and performs handoff', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        status: 'completed',
        attach: {},
        runtime: {
          runAttempt: 1,
          checkpoint: {
            adapterId: 'local',
            taskId: 'task-1',
            runId: 'run-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: {
              workerPid: 123,
              worktreePath: '/repo/.port/trees/port-task-task-1',
              branch: 'port-task-task-1',
            },
          },
          runs: [
            {
              attempt: 1,
              runId: 'run-1',
              status: 'completed',
              startedAt: '2026-01-01T00:00:00.000Z',
              finishedAt: '2026-01-01T00:00:01.000Z',
            },
          ],
        },
      },
    })
    mocks.getTask
      .mockResolvedValueOnce({
        id: 'task-1',
        displayId: 1,
        status: 'completed',
        attach: {},
        runtime: {
          runAttempt: 1,
          checkpoint: {
            adapterId: 'local',
            taskId: 'task-1',
            runId: 'run-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: {
              workerPid: 123,
              worktreePath: '/repo/.port/trees/port-task-task-1',
              branch: 'port-task-task-1',
            },
          },
          runs: [
            {
              attempt: 1,
              runId: 'run-1',
              status: 'completed',
              startedAt: '2026-01-01T00:00:00.000Z',
              finishedAt: '2026-01-01T00:00:01.000Z',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        id: 'task-1',
        displayId: 1,
        attach: {},
        runtime: {
          runAttempt: 1,
          checkpoint: {
            adapterId: 'local',
            taskId: 'task-1',
            runId: 'run-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: {
              workerPid: 123,
              worktreePath: '/repo/.port/trees/port-task-task-1',
              branch: 'port-task-task-1',
            },
          },
          runs: [
            {
              attempt: 1,
              runId: 'run-1',
              status: 'completed',
              startedAt: '2026-01-01T00:00:00.000Z',
              finishedAt: '2026-01-01T00:00:01.000Z',
            },
          ],
        },
      })

    await taskAttach('1')

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'reviving_for_attach',
      'Attach requested; reviving task'
    )
    expect(mocks.patchTask).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      expect.objectContaining({ runtime: expect.any(Object), attach: expect.any(Object) }),
      expect.objectContaining({ type: 'task.attach.revive_succeeded' })
    )
    // With attach-capable adapter, handoff is performed and task reaches paused_for_attach
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'paused_for_attach',
      'Attach handoff ready'
    )
    expect(mocks.patchTask).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      expect.objectContaining({
        attach: expect.objectContaining({ state: 'handoff_ready' }),
      }),
      expect.objectContaining({ type: 'task.attach.handoff_ready' })
    )
  })

  test('task attach falls through to running when adapter lacks handoff support', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        status: 'completed',
        attach: {},
        runtime: {
          runAttempt: 1,
          checkpoint: {
            adapterId: 'local',
            taskId: 'task-1',
            runId: 'run-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: {
              workerPid: 123,
              worktreePath: '/repo/.port/trees/port-task-task-1',
              branch: 'port-task-task-1',
            },
          },
        },
      },
    })
    mocks.getTask.mockResolvedValue({
      id: 'task-1',
      displayId: 1,
      status: 'completed',
      attach: {},
      runtime: {
        runAttempt: 1,
        checkpoint: {
          adapterId: 'local',
          taskId: 'task-1',
          runId: 'run-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          payload: {
            workerPid: 123,
            worktreePath: '/repo/.port/trees/port-task-task-1',
            branch: 'port-task-task-1',
          },
        },
      },
    })

    mocks.resolveTaskAdapter.mockResolvedValue({
      adapter: {
        id: 'stub-remote',
        capabilities: {
          supportsCheckpoint: true,
          supportsRestore: true,
          supportsAttachHandoff: false,
        },
        restore: vi.fn().mockResolvedValue({
          taskId: 'task-1',
          runId: 'run-2',
          workerPid: 777,
          worktreePath: '/repo/.port/trees/port-task-task-1',
          branch: 'port-task-task-1',
        }),
        checkpoint: vi.fn().mockResolvedValue({
          adapterId: 'stub-remote',
          taskId: 'task-1',
          runId: 'run-2',
          createdAt: '2026-01-01T00:00:00.000Z',
          payload: {
            workerPid: 777,
            worktreePath: '/repo/.port/trees/port-task-task-1',
            branch: 'port-task-task-1',
          },
        }),
      },
      configuredId: 'stub-remote',
      resolvedId: 'stub-remote',
      fallbackUsed: false,
    })

    await taskAttach('1')

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'running',
      'Revived for attach'
    )
    expect(mocks.info).toHaveBeenCalledWith(
      'Interactive attach handoff UI is not implemented yet; task continues in background.'
    )
  })

  test('task attach requests adapter handoff when adapter supports attach', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        status: 'completed',
        attach: {},
        runtime: {
          runAttempt: 1,
          checkpoint: {
            adapterId: 'local',
            taskId: 'task-1',
            runId: 'run-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: {
              workerPid: 123,
              worktreePath: '/repo/.port/trees/port-task-task-1',
              branch: 'port-task-task-1',
            },
          },
        },
      },
    })

    mocks.getTask.mockResolvedValue({
      id: 'task-1',
      displayId: 1,
      status: 'completed',
      attach: {},
      runtime: {
        runAttempt: 1,
        checkpoint: {
          adapterId: 'local',
          taskId: 'task-1',
          runId: 'run-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          payload: {
            workerPid: 123,
            worktreePath: '/repo/.port/trees/port-task-task-1',
            branch: 'port-task-task-1',
          },
        },
      },
    })

    const requestHandoff = vi.fn().mockResolvedValue({
      boundary: 'tool_return',
      sessionHandle: 'session-1',
      readyAt: '2026-01-01T00:00:02.000Z',
    })
    const attachContext = vi.fn().mockResolvedValue({
      sessionHandle: 'session-1',
      checkpointRunId: 'run-2',
      checkpointCreatedAt: '2026-01-01T00:00:02.000Z',
      workspaceRef: '/repo/.port/trees/port-task-task-1',
      resumeToken: {
        token: 'resume-token-1',
        expiresAt: '2026-01-01T00:30:00.000Z',
      },
      restoreStrategy: 'native_session',
      summary: 'continue from native session',
      transcriptPath: '/repo/.port/jobs/artifacts/task-1/attach/io.log',
    })

    mocks.resolveTaskAdapter.mockResolvedValue({
      adapter: {
        id: 'local',
        capabilities: {
          supportsCheckpoint: true,
          supportsRestore: true,
          supportsAttachHandoff: true,
          supportsResumeToken: true,
          supportsTranscript: true,
          supportsFailedSnapshot: true,
        },
        restore: vi.fn().mockResolvedValue({
          taskId: 'task-1',
          runId: 'run-2',
          workerPid: 777,
          worktreePath: '/repo/.port/trees/port-task-task-1',
          branch: 'port-task-task-1',
        }),
        checkpoint: vi.fn().mockResolvedValue({
          adapterId: 'local',
          taskId: 'task-1',
          runId: 'run-2',
          createdAt: '2026-01-01T00:00:00.000Z',
          payload: {
            workerPid: 777,
            worktreePath: '/repo/.port/trees/port-task-task-1',
            branch: 'port-task-task-1',
          },
        }),
        requestHandoff,
        attachContext,
        resumeFromAttach: vi.fn(),
      },
      configuredId: 'local',
      resolvedId: 'local',
      fallbackUsed: false,
    })

    await taskAttach('1')

    expect(requestHandoff).toHaveBeenCalled()
    expect(attachContext).toHaveBeenCalled()
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      'paused_for_attach',
      'Attach handoff ready'
    )
    expect(mocks.success).toHaveBeenCalledWith(
      'Attach handoff ready for #1 (task-1) at tool_return'
    )
  })

  test('task attach fails without checkpoint', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: { id: 'task-1', displayId: 1, status: 'completed', runtime: {} },
    })

    await expect(taskAttach('1')).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith(
      'Task #1 (task-1) does not have checkpoint data required for attach revival'
    )
  })

  test('task attach rejects lock conflicts without --force', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        status: 'running',
        attach: {
          state: 'client_attached',
          lockOwner: 'other-user',
          sessionHandle: 'session-22',
        },
        runtime: {
          checkpoint: {
            adapterId: 'local',
            taskId: 'task-1',
            runId: 'run-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: {
              workerPid: 123,
              worktreePath: '/repo/.port/trees/port-task-task-1',
              branch: 'port-task-task-1',
            },
          },
        },
      },
    })

    const originalUser = process.env.USER
    process.env.USER = 'current-user'

    try {
      await expect(taskAttach('1')).rejects.toBeInstanceOf(CliError)
      expect(mocks.error).toHaveBeenCalledWith(
        'Task #1 (task-1) attach lock is held by other-user (session session-22); retry with --force to take over'
      )
      expect(mocks.resolveTaskAdapter).not.toHaveBeenCalled()
    } finally {
      process.env.USER = originalUser
    }
  })

  test('task attach force mode revokes prior lock owner before revive', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: true,
      matchedBy: 'display_id',
      task: {
        id: 'task-1',
        displayId: 1,
        status: 'running',
        attach: {
          state: 'client_attached',
          lockOwner: 'other-user',
          sessionHandle: 'session-22',
        },
        runtime: {
          runAttempt: 1,
          checkpoint: {
            adapterId: 'local',
            taskId: 'task-1',
            runId: 'run-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: {
              workerPid: 123,
              worktreePath: '/repo/.port/trees/port-task-task-1',
              branch: 'port-task-task-1',
            },
          },
        },
      },
    })

    mocks.getTask.mockResolvedValue({
      id: 'task-1',
      displayId: 1,
      status: 'running',
      attach: {
        state: 'pending_handoff',
        lockOwner: 'current-user',
      },
      runtime: {
        runAttempt: 1,
        checkpoint: {
          adapterId: 'local',
          taskId: 'task-1',
          runId: 'run-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          payload: {
            workerPid: 123,
            worktreePath: '/repo/.port/trees/port-task-task-1',
            branch: 'port-task-task-1',
          },
        },
      },
    })

    const originalUser = process.env.USER
    process.env.USER = 'current-user'

    try {
      await taskAttach('1', { force: true })
    } finally {
      process.env.USER = originalUser
    }

    expect(mocks.patchTask).toHaveBeenCalledWith(
      '/repo',
      'task-1',
      expect.objectContaining({
        attach: expect.objectContaining({ state: 'revoked', lockOwner: 'current-user' }),
      }),
      expect.objectContaining({ type: 'task.attach.revoked' })
    )
  })

  test('task read reports ambiguity candidates', async () => {
    mocks.resolveTaskRef.mockResolvedValue({
      ok: false,
      kind: 'ambiguous',
      ref: 'a',
      candidates: [
        { id: 'task-a1111111', displayId: 1 },
        { id: 'task-a2222222', displayId: 2 },
      ],
    })

    await expect(taskRead('a')).rejects.toBeInstanceOf(CliError)
    expect(mocks.error).toHaveBeenCalledWith(
      'Task id "a" is ambiguous: #1 (task-a1111111), #2 (task-a2222222); use a longer prefix or numeric id'
    )
  })
})

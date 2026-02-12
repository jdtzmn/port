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
  taskArtifacts,
  taskCancel,
  taskCleanup,
  taskDaemon,
  taskList,
  taskLogs,
  taskRead,
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
    mocks.readTaskEvents.mockResolvedValue([])
    mocks.readGlobalTaskEvents.mockResolvedValue({ events: [], nextLine: 0 })
    mocks.consumeGlobalTaskEvents.mockResolvedValue(0)
  })

  test('task start queues a task and ensures daemon', async () => {
    mocks.createTask.mockResolvedValue({ id: 'task-abc12345', mode: 'write', title: 'hello' })

    await taskStart('hello')

    expect(mocks.createTask).toHaveBeenCalledWith('/repo', {
      title: 'hello',
      mode: undefined,
      branch: undefined,
    })
    expect(mocks.ensureTaskDaemon).toHaveBeenCalledWith('/repo')
    expect(mocks.success).toHaveBeenCalledWith('Queued task-abc12345 (write)')
  })

  test('task list prints no tasks message when empty', async () => {
    mocks.listTasks.mockResolvedValue([])

    await taskList()

    expect(mocks.info).toHaveBeenCalledWith('No tasks found.')
  })

  test('task read throws cli error when task is missing', async () => {
    mocks.getTask.mockResolvedValue(null)

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
    mocks.getTask.mockResolvedValue({ id: 'task-1', title: 'done' })

    await taskArtifacts('task-1')

    expect(mocks.header).toHaveBeenCalledWith('Artifacts for task-1:')
  })

  test('task logs prints log content', async () => {
    mocks.getTask.mockResolvedValue({ id: 'task-1', title: 'done' })
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

    await taskLogs('task-1')

    expect(mocks.getTaskStdoutPath).toHaveBeenCalledWith('/repo', 'task-1')
  })

  test('task wait exits when task is terminal', async () => {
    mocks.getTask.mockResolvedValue({ id: 'task-1', status: 'completed' })
    mocks.isTerminalTaskStatus.mockReturnValue(true)

    await taskWait('task-1')

    expect(mocks.success).toHaveBeenCalledWith('Task task-1 is completed')
  })

  test('task cancel marks task cancelled', async () => {
    mocks.getTask.mockResolvedValue({
      id: 'task-1',
      status: 'running',
      runtime: { workerPid: 123 },
    })
    mocks.patchTask.mockResolvedValue(undefined)
    mocks.updateTaskStatus.mockResolvedValue(undefined)

    await taskCancel('task-1')

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
    mocks.getTask.mockResolvedValue({ id: 'task-1', title: 'done', mode: 'write' })
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.readTaskCommitRefs.mockResolvedValue(['abc123'])

    await taskApply('task-1', { method: 'auto', squash: false })

    expect(mocks.execFileAsync).toHaveBeenCalledWith('git', ['cherry-pick', 'abc123'], {
      cwd: '/repo',
    })
  })

  test('task apply falls back to patch when no refs', async () => {
    mocks.getTask.mockResolvedValue({ id: 'task-1', title: 'done', mode: 'write' })
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.readTaskCommitRefs.mockResolvedValue([])

    await taskApply('task-1', { method: 'auto', squash: false })

    expect(mocks.execFileAsync).toHaveBeenCalledWith(
      'git',
      ['apply', '--3way', '/repo/.port/jobs/artifacts/task-1/changes.patch'],
      { cwd: '/repo' }
    )
  })
})

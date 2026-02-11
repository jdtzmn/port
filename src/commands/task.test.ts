import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CliError } from '../lib/cli.ts'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  createTask: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  ensureTaskDaemon: vi.fn(),
  runTaskDaemon: vi.fn(),
  stopTaskDaemon: vi.fn(),
  cleanupTaskRuntime: vi.fn(),
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

import { taskCleanup, taskDaemon, taskList, taskRead, taskStart } from './task.ts'

describe('task command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.branch.mockImplementation((value: string) => value)
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
})

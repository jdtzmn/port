import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { createWorktree, deleteLocalBranch, removeWorktreeAtPath } from './git.ts'
import type { PortTask } from './taskStore.ts'

export interface TaskRunHandle {
  taskId: string
  runId: string
  workerPid: number
  worktreePath: string
  branch: string
}

export interface PreparedExecution {
  taskId: string
  runId: string
  worktreePath: string
  branch: string
}

export interface TaskExecutionAdapter {
  id: string
  prepare(repoRoot: string, task: PortTask): Promise<PreparedExecution>
  start(repoRoot: string, task: PortTask, prepared: PreparedExecution): Promise<TaskRunHandle>
  status(handle: TaskRunHandle): Promise<'running' | 'exited'>
  cancel(handle: TaskRunHandle): Promise<void>
  cleanup(repoRoot: string, handle: TaskRunHandle): Promise<void>
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function buildTaskBranch(task: PortTask): string {
  return `port-task-${task.id}`
}

export class LocalTaskExecutionAdapter implements TaskExecutionAdapter {
  readonly id = 'local'

  constructor(private readonly scriptPath: string) {}

  async prepare(repoRoot: string, task: PortTask): Promise<PreparedExecution> {
    const branch = buildTaskBranch(task)
    const worktreePath = await createWorktree(repoRoot, branch)

    return {
      taskId: task.id,
      runId: randomUUID(),
      worktreePath,
      branch,
    }
  }

  async start(
    repoRoot: string,
    task: PortTask,
    prepared: PreparedExecution
  ): Promise<TaskRunHandle> {
    const child = spawn(
      process.execPath,
      [
        this.scriptPath,
        'task',
        'worker',
        '--task-id',
        task.id,
        '--repo',
        repoRoot,
        '--worktree',
        prepared.worktreePath,
      ],
      {
        cwd: prepared.worktreePath,
        stdio: 'ignore',
      }
    )

    if (!child.pid) {
      throw new Error(`Failed to start worker for task ${task.id}`)
    }

    return {
      taskId: task.id,
      runId: prepared.runId,
      workerPid: child.pid,
      worktreePath: prepared.worktreePath,
      branch: prepared.branch,
    }
  }

  async status(handle: TaskRunHandle): Promise<'running' | 'exited'> {
    return isProcessAlive(handle.workerPid) ? 'running' : 'exited'
  }

  async cancel(handle: TaskRunHandle): Promise<void> {
    if (isProcessAlive(handle.workerPid)) {
      process.kill(handle.workerPid, 'SIGTERM')
    }
  }

  async cleanup(repoRoot: string, handle: TaskRunHandle): Promise<void> {
    if (!existsSync(handle.worktreePath)) {
      try {
        await deleteLocalBranch(repoRoot, handle.branch, true)
      } catch {
        // Branch may already be removed.
      }
      return
    }

    await removeWorktreeAtPath(repoRoot, handle.worktreePath, true)
    try {
      await deleteLocalBranch(repoRoot, handle.branch, true)
    } catch {
      // Branch may still be useful for debug or already removed.
    }
  }
}

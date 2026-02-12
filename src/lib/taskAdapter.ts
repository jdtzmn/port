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

export interface TaskCheckpointRef {
  adapterId: string
  taskId: string
  runId: string
  createdAt: string
  payload: {
    workerPid: number
    worktreePath: string
    branch: string
  }
}

export interface PreparedExecution {
  taskId: string
  runId: string
  worktreePath: string
  branch: string
}

export interface TaskExecutionAdapter {
  id: string
  capabilities: {
    supportsCheckpoint: boolean
    supportsRestore: boolean
    supportsAttachHandoff: boolean
  }
  prepare(repoRoot: string, task: PortTask): Promise<PreparedExecution>
  start(repoRoot: string, task: PortTask, prepared: PreparedExecution): Promise<TaskRunHandle>
  status(handle: TaskRunHandle): Promise<'running' | 'exited'>
  checkpoint(handle: TaskRunHandle): Promise<TaskCheckpointRef>
  restore(repoRoot: string, task: PortTask, checkpoint: TaskCheckpointRef): Promise<TaskRunHandle>
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
  readonly capabilities = {
    supportsCheckpoint: true,
    supportsRestore: true,
    supportsAttachHandoff: false,
  }

  constructor(private readonly scriptPath: string) {}

  private async spawnWorker(
    repoRoot: string,
    taskId: string,
    worktreePath: string,
    branch: string,
    runId: string
  ): Promise<TaskRunHandle> {
    const child = spawn(
      process.execPath,
      [
        this.scriptPath,
        'task',
        'worker',
        '--task-id',
        taskId,
        '--repo',
        repoRoot,
        '--worktree',
        worktreePath,
      ],
      {
        cwd: worktreePath,
        stdio: 'ignore',
      }
    )

    if (!child.pid) {
      throw new Error(`Failed to start worker for task ${taskId}`)
    }

    return {
      taskId,
      runId,
      workerPid: child.pid,
      worktreePath,
      branch,
    }
  }

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
    return this.spawnWorker(
      repoRoot,
      task.id,
      prepared.worktreePath,
      prepared.branch,
      prepared.runId
    )
  }

  async status(handle: TaskRunHandle): Promise<'running' | 'exited'> {
    return isProcessAlive(handle.workerPid) ? 'running' : 'exited'
  }

  async checkpoint(handle: TaskRunHandle): Promise<TaskCheckpointRef> {
    return {
      adapterId: this.id,
      taskId: handle.taskId,
      runId: handle.runId,
      createdAt: new Date().toISOString(),
      payload: {
        workerPid: handle.workerPid,
        worktreePath: handle.worktreePath,
        branch: handle.branch,
      },
    }
  }

  async restore(
    repoRoot: string,
    task: PortTask,
    checkpoint: TaskCheckpointRef
  ): Promise<TaskRunHandle> {
    const payload = checkpoint.payload
    const branch = payload.branch || buildTaskBranch(task)

    if (isProcessAlive(payload.workerPid) && existsSync(payload.worktreePath)) {
      return {
        taskId: task.id,
        runId: checkpoint.runId,
        workerPid: payload.workerPid,
        worktreePath: payload.worktreePath,
        branch,
      }
    }

    let worktreePath = payload.worktreePath
    if (!worktreePath || !existsSync(worktreePath)) {
      worktreePath = await createWorktree(repoRoot, branch)
    }

    return this.spawnWorker(repoRoot, task.id, worktreePath, branch, randomUUID())
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

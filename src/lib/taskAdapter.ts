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
  opencode?: OpenCodeCheckpointMetadata
}

export interface OpenCodeCheckpointMetadata {
  sessionId?: string
  transcriptPath?: string
  workspaceRef?: string
  fallbackSummary?: string
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
    opencode?: OpenCodeCheckpointMetadata
  }
}

export interface OpenCodeContinuePlan {
  strategy: 'native_session' | 'fallback_summary'
  command: string
  args: string[]
  summary: string
  sessionId?: string
  workspaceRef: string
  transcriptPath?: string
}

export interface AttachResumeToken {
  token: string
  expiresAt: string
}

export interface AttachHandoffReady {
  boundary: 'tool_return' | 'immediate'
  sessionHandle: string
  readyAt: string
}

export interface AttachContext {
  sessionHandle: string
  checkpointRunId: string
  checkpointCreatedAt: string
  workspaceRef: string
  resumeToken?: AttachResumeToken
  restoreStrategy: 'native_session' | 'fallback_summary'
  summary: string
  transcriptPath?: string
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
    supportsResumeToken: boolean
    supportsTranscript: boolean
    supportsFailedSnapshot: boolean
  }
  prepare(repoRoot: string, task: PortTask): Promise<PreparedExecution>
  start(repoRoot: string, task: PortTask, prepared: PreparedExecution): Promise<TaskRunHandle>
  status(handle: TaskRunHandle): Promise<'running' | 'exited'>
  checkpoint(handle: TaskRunHandle): Promise<TaskCheckpointRef>
  restore(repoRoot: string, task: PortTask, checkpoint: TaskCheckpointRef): Promise<TaskRunHandle>
  requestHandoff(handle: TaskRunHandle): Promise<AttachHandoffReady>
  attachContext(handle: TaskRunHandle): Promise<AttachContext>
  resumeFromAttach(handle: TaskRunHandle, token?: AttachResumeToken): Promise<void>
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

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function buildDefaultFallbackSummary(checkpoint: TaskCheckpointRef): string {
  return [
    `Continue task ${checkpoint.taskId} from run ${checkpoint.runId}.`,
    `Workspace: ${checkpoint.payload.worktreePath}`,
    `Branch: ${checkpoint.payload.branch}`,
    `Review artifacts under .port/jobs/artifacts/${checkpoint.taskId} before continuing.`,
  ].join(' ')
}

export function buildOpenCodeContinuePlan(
  repoRoot: string,
  checkpoint: TaskCheckpointRef
): OpenCodeContinuePlan {
  const opencode = checkpoint.payload.opencode
  const sessionId = normalizeOptionalString(opencode?.sessionId)
  const transcriptPath = normalizeOptionalString(opencode?.transcriptPath)
  const workspaceRef =
    normalizeOptionalString(opencode?.workspaceRef) ??
    normalizeOptionalString(checkpoint.payload.worktreePath) ??
    repoRoot
  const summary =
    normalizeOptionalString(opencode?.fallbackSummary) ?? buildDefaultFallbackSummary(checkpoint)

  if (sessionId) {
    return {
      strategy: 'native_session',
      command: 'opencode',
      args: ['--continue', sessionId],
      summary,
      sessionId,
      workspaceRef,
      transcriptPath,
    }
  }

  return {
    strategy: 'fallback_summary',
    command: 'opencode',
    args: [],
    summary,
    workspaceRef,
    transcriptPath,
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
    supportsResumeToken: false,
    supportsTranscript: false,
    supportsFailedSnapshot: false,
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
    const checkpoint: TaskCheckpointRef = {
      adapterId: this.id,
      taskId: handle.taskId,
      runId: handle.runId,
      createdAt: new Date().toISOString(),
      payload: {
        workerPid: handle.workerPid,
        worktreePath: handle.worktreePath,
        branch: handle.branch,
        opencode: {
          sessionId: normalizeOptionalString(handle.opencode?.sessionId),
          transcriptPath: normalizeOptionalString(handle.opencode?.transcriptPath),
          workspaceRef:
            normalizeOptionalString(handle.opencode?.workspaceRef) ?? handle.worktreePath,
          fallbackSummary:
            normalizeOptionalString(handle.opencode?.fallbackSummary) ??
            `Continue task ${handle.taskId} from run ${handle.runId} in ${handle.worktreePath} on ${handle.branch}. Review .port/jobs/artifacts/${handle.taskId} before continuing.`,
        },
      },
    }

    return checkpoint
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

  async requestHandoff(_handle: TaskRunHandle): Promise<AttachHandoffReady> {
    throw new Error('local adapter does not support attach handoff yet')
  }

  async attachContext(_handle: TaskRunHandle): Promise<AttachContext> {
    throw new Error('local adapter does not provide attach context yet')
  }

  async resumeFromAttach(_handle: TaskRunHandle, _token?: AttachResumeToken): Promise<void> {
    throw new Error('local adapter does not support attach resume yet')
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

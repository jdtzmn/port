import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  countActiveTasks,
  getTaskRuntimeDir,
  listRunningTasks,
  listRunnableQueuedTasks,
  patchTask,
  reconcileTaskQueue,
  type PortTask,
  updateTaskStatus,
} from './taskStore.ts'
import { withFileLock, writeFileAtomic } from './state.ts'
import { loadConfig } from './config.ts'
import type { TaskCheckpointRef, TaskRunHandle } from './taskAdapter.ts'
import { resolveTaskAdapter } from './taskAdapterRegistry.ts'
import { dispatchConfiguredTaskSubscribers } from './taskSubscribers.ts'

export interface DaemonState {
  pid: number
  id: string
  startedAt: string
  heartbeatAt: string
  idleSince: string | null
  status: 'starting' | 'running' | 'stopping'
}

const DAEMON_FILE = 'daemon.json'
const DAEMON_START_LOCK_FILE = 'daemon-start.lock'
const LOOP_POLL_MS = 1000

export const DEFAULT_DAEMON_IDLE_STOP_MS = 10 * 60 * 1000
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000

function nowIso(): string {
  return new Date().toISOString()
}

function getDaemonStatePath(repoRoot: string): string {
  return join(getTaskRuntimeDir(repoRoot), DAEMON_FILE)
}

function getDaemonStartLockPath(repoRoot: string): string {
  return join(getTaskRuntimeDir(repoRoot), DAEMON_START_LOCK_FILE)
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

export async function readDaemonState(repoRoot: string): Promise<DaemonState | null> {
  const filePath = getDaemonStatePath(repoRoot)
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as DaemonState
    if (!parsed?.pid || typeof parsed.id !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function writeDaemonState(repoRoot: string, state: DaemonState): Promise<void> {
  const runtimeDir = getTaskRuntimeDir(repoRoot)
  await mkdir(runtimeDir, { recursive: true })
  await writeFileAtomic(getDaemonStatePath(repoRoot), `${JSON.stringify(state, null, 2)}\n`)
}

async function isDaemonAlive(repoRoot: string): Promise<boolean> {
  const state = await readDaemonState(repoRoot)
  if (!state) {
    return false
  }

  return isProcessAlive(state.pid)
}

export async function ensureTaskDaemon(repoRoot: string): Promise<void> {
  await mkdir(getTaskRuntimeDir(repoRoot), { recursive: true })
  await withFileLock(getDaemonStartLockPath(repoRoot), async () => {
    if (await isDaemonAlive(repoRoot)) {
      return
    }

    const scriptPath = process.argv[1]
    if (!scriptPath) {
      throw new Error('Unable to determine CLI entrypoint for daemon start')
    }

    const child = spawn(
      process.execPath,
      [scriptPath, 'task', 'daemon', '--serve', '--repo', repoRoot],
      {
        detached: true,
        stdio: 'ignore',
      }
    )

    child.unref()
  })
}

export async function stopTaskDaemon(
  repoRoot: string,
  options: { force?: boolean } = {}
): Promise<{ stopped: boolean; reason: 'not_running' | 'active_tasks' | 'stopped' }> {
  const state = await readDaemonState(repoRoot)
  if (!state || !isProcessAlive(state.pid)) {
    return { stopped: false, reason: 'not_running' }
  }

  if (!options.force) {
    const activeCount = await countActiveTasks(repoRoot)
    if (activeCount > 0) {
      return { stopped: false, reason: 'active_tasks' }
    }
  }

  process.kill(state.pid, 'SIGTERM')
  return { stopped: true, reason: 'stopped' }
}

export async function cleanupTaskRuntime(repoRoot: string): Promise<void> {
  await rm(getTaskRuntimeDir(repoRoot), { recursive: true, force: true })
}

async function resolveIdleStopMs(repoRoot: string, overrideMs?: number): Promise<number> {
  if (overrideMs !== undefined) {
    return overrideMs
  }

  try {
    const config = await loadConfig(repoRoot)
    const minutes = config.task?.daemonIdleStopMinutes
    if (typeof minutes === 'number' && minutes > 0) {
      return minutes * 60 * 1000
    }
  } catch {
    // Use defaults when config is missing/invalid.
  }

  return DEFAULT_DAEMON_IDLE_STOP_MS
}

export async function runTaskDaemon(
  repoRoot: string,
  options: { idleStopMs?: number } = {}
): Promise<void> {
  const idleStopMs = await resolveIdleStopMs(repoRoot, options.idleStopMs)
  const daemonId = randomUUID()
  let stopping = false

  let state: DaemonState = {
    pid: process.pid,
    id: daemonId,
    startedAt: nowIso(),
    heartbeatAt: nowIso(),
    idleSince: null,
    status: 'starting',
  }

  const scriptPath = process.argv[1]
  if (!scriptPath) {
    throw new Error('Unable to determine CLI entrypoint for daemon worker execution')
  }
  const adapterResolution = await resolveTaskAdapter(repoRoot, scriptPath)
  const adapter = adapterResolution.adapter

  async function getTaskTimeoutMs(): Promise<number> {
    try {
      const config = await loadConfig(repoRoot)
      const minutes = config.task?.timeoutMinutes
      if (typeof minutes === 'number' && minutes > 0) {
        return minutes * 60 * 1000
      }
    } catch {
      // Use default timeout.
    }

    return DEFAULT_TASK_TIMEOUT_MS
  }

  async function persistCheckpoint(
    taskId: string,
    runtime: NonNullable<PortTask['runtime']>,
    checkpoint: TaskCheckpointRef,
    eventType: string,
    eventMessage: string
  ): Promise<void> {
    await patchTask(
      repoRoot,
      taskId,
      {
        runtime: {
          ...runtime,
          checkpoint,
          checkpointHistory: [...(runtime.checkpointHistory ?? []), checkpoint],
        },
      },
      {
        type: eventType,
        message: eventMessage,
      }
    )
  }

  function appendRunStart(
    runtime: NonNullable<PortTask['runtime']>,
    options: {
      attempt: number
      runId: string
      status: 'started' | 'restored'
      startedAt: string
      reason?: string
    }
  ): NonNullable<PortTask['runtime']> {
    return {
      ...runtime,
      runAttempt: options.attempt,
      activeRunId: options.runId,
      runs: [
        ...(runtime.runs ?? []),
        {
          attempt: options.attempt,
          runId: options.runId,
          status: options.status,
          startedAt: options.startedAt,
          reason: options.reason,
        },
      ],
    }
  }

  function markRunTerminal(
    runtime: NonNullable<PortTask['runtime']>,
    status: 'completed' | 'failed' | 'timeout' | 'cancelled',
    finishedAt: string
  ): NonNullable<PortTask['runtime']> {
    const runs = [...(runtime.runs ?? [])]
    const targetIndex = runtime.activeRunId
      ? runs.findIndex(run => run.runId === runtime.activeRunId)
      : runs.length - 1

    if (targetIndex >= 0 && runs[targetIndex]) {
      runs[targetIndex] = {
        ...runs[targetIndex],
        status,
        finishedAt,
      }
    }

    return {
      ...runtime,
      activeRunId: undefined,
      finishedAt,
      runs,
    }
  }

  async function buildRunHandle(taskId: string): Promise<TaskRunHandle | null> {
    const runningTasks = await listRunningTasks(repoRoot)
    const task = runningTasks.find(candidate => candidate.id === taskId)
    const runtime = task?.runtime
    if (!task || !runtime?.workerPid || !runtime.worktreePath) {
      return null
    }

    return {
      taskId,
      runId: runtime.checkpoint?.runId ?? `${taskId}-unknown`,
      workerPid: runtime.workerPid,
      worktreePath: runtime.worktreePath,
      branch: task.branch ?? `port-task-${taskId}`,
    }
  }

  async function attemptRestoreFromCheckpoint(
    task: PortTask,
    runtime: NonNullable<PortTask['runtime']>,
    reason: string
  ): Promise<boolean> {
    if (!adapter.capabilities.supportsRestore || !runtime.checkpoint) {
      return false
    }

    try {
      const restoredHandle = await adapter.restore(repoRoot, task, runtime.checkpoint)
      const checkpoint = await adapter.checkpoint(restoredHandle)
      const resumedAt = nowIso()
      const timeoutAt =
        runtime.timeoutAt ?? new Date(Date.now() + (await getTaskTimeoutMs())).toISOString()
      const nextRuntime = appendRunStart(
        {
          ...runtime,
          workerPid: restoredHandle.workerPid,
          worktreePath: restoredHandle.worktreePath,
          startedAt: resumedAt,
          timeoutAt,
          retainedForDebug: false,
        },
        {
          attempt: (runtime.runAttempt ?? 0) + 1,
          runId: checkpoint.runId,
          status: 'restored',
          startedAt: resumedAt,
          reason,
        }
      )

      await persistCheckpoint(
        task.id,
        nextRuntime,
        checkpoint,
        'task.run.continuation_started',
        `${reason};run=${checkpoint.runId}`
      )
      await updateTaskStatus(repoRoot, task.id, 'running', 'Restored from adapter checkpoint')
      return true
    } catch (error) {
      await updateTaskStatus(repoRoot, task.id, 'failed', `Checkpoint restore failed: ${error}`)
      await patchTask(
        repoRoot,
        task.id,
        {
          runtime: markRunTerminal(
            {
              ...runtime,
              retainedForDebug: true,
            },
            'failed',
            nowIso()
          ),
        },
        {
          type: 'task.restore.failed',
          message: `${error}`,
        }
      )
      return true
    }
  }

  async function handleRunningTasks(): Promise<void> {
    const runningTasks = await listRunningTasks(repoRoot)

    for (const task of runningTasks) {
      const runtime = task.runtime
      if (!runtime) {
        continue
      }

      if (!runtime.workerPid || !runtime.worktreePath) {
        if (task.status === 'resuming') {
          await attemptRestoreFromCheckpoint(task, runtime, 'resume_without_live_worker')
        }
        continue
      }

      const handle: TaskRunHandle = {
        taskId: task.id,
        runId: runtime.checkpoint?.runId ?? `${task.id}-runtime`,
        workerPid: runtime.workerPid,
        worktreePath: runtime.worktreePath,
        branch: task.branch ?? `port-task-${task.id}`,
      }

      const timedOut = runtime.timeoutAt
        ? Date.now() >= new Date(runtime.timeoutAt).getTime()
        : false

      if (timedOut) {
        await adapter.cancel(handle)
        await patchTask(
          repoRoot,
          task.id,
          {
            runtime: {
              ...markRunTerminal(runtime, 'timeout', nowIso()),
              retainedForDebug: true,
            },
          },
          {
            type: 'task.worker.timeout',
            message: 'Worker exceeded configured task timeout',
          }
        )
        await updateTaskStatus(repoRoot, task.id, 'timeout', 'Worker exceeded task timeout')
        continue
      }

      const workerStatus = await adapter.status(handle)
      if (workerStatus === 'running') {
        if (adapter.capabilities.supportsCheckpoint) {
          try {
            const checkpoint = await adapter.checkpoint(handle)
            await patchTask(
              repoRoot,
              task.id,
              {
                runtime: {
                  ...runtime,
                  checkpoint,
                },
              },
              {
                type: 'task.checkpoint.updated',
                message: `run=${checkpoint.runId}`,
              }
            )
          } catch {
            // Ignore checkpoint refresh failures to keep execution moving.
          }
        }
        continue
      }

      const refreshed = await patchTask(repoRoot, task.id, {}, undefined)
      if (!refreshed) {
        continue
      }

      if (refreshed.status === 'completed') {
        try {
          await adapter.cleanup(repoRoot, handle)
          await patchTask(
            repoRoot,
            task.id,
            {
              runtime: {
                ...markRunTerminal(refreshed.runtime ?? runtime, 'completed', nowIso()),
                cleanedAt: nowIso(),
                retainedForDebug: false,
              },
            },
            {
              type: 'task.worker.cleaned',
              message: 'Ephemeral worktree removed after successful completion',
            }
          )
        } catch (error) {
          await patchTask(
            repoRoot,
            task.id,
            {
              runtime: {
                ...(refreshed.runtime ?? runtime),
                retainedForDebug: true,
              },
            },
            {
              type: 'task.worker.cleanup_failed',
              message: `Failed to remove worktree: ${error}`,
            }
          )
        }
        continue
      }

      if (
        refreshed.status === 'failed' ||
        refreshed.status === 'cancelled' ||
        refreshed.status === 'timeout'
      ) {
        await patchTask(
          repoRoot,
          task.id,
          {
            runtime: {
              ...markRunTerminal(
                refreshed.runtime ?? runtime,
                refreshed.status,
                refreshed.runtime?.finishedAt ?? nowIso()
              ),
              retainedForDebug: true,
            },
          },
          {
            type: 'task.worker.retained',
            message: 'Task failed and worktree was retained for debugging',
          }
        )
        continue
      }

      if (
        adapter.capabilities.supportsRestore &&
        refreshed.runtime?.checkpoint &&
        (refreshed.status === 'running' ||
          refreshed.status === 'preparing' ||
          refreshed.status === 'resuming')
      ) {
        await updateTaskStatus(repoRoot, task.id, 'resuming', 'Attempting restore from checkpoint')
        await attemptRestoreFromCheckpoint(task, refreshed.runtime, 'worker_exited_non_terminal')
        continue
      }

      await updateTaskStatus(repoRoot, task.id, 'failed', 'Worker exited unexpectedly')
      await patchTask(
        repoRoot,
        task.id,
        {
          runtime: {
            ...markRunTerminal(refreshed.runtime ?? runtime, 'failed', nowIso()),
            retainedForDebug: true,
          },
        },
        {
          type: 'task.worker.crashed',
          message: 'Worker process exited without reporting terminal status',
        }
      )
    }
  }

  async function startRunnableTasks(): Promise<void> {
    const timeoutMs = await getTaskTimeoutMs()
    const runnable = await listRunnableQueuedTasks(repoRoot)
    const task = runnable[0]

    if (!task) {
      return
    }

    await updateTaskStatus(repoRoot, task.id, 'preparing', 'Preparing local worker')
    await patchTask(
      repoRoot,
      task.id,
      {
        adapter: adapter.id,
        capabilities: {
          ...(task.capabilities ?? {}),
          supportsCheckpoint: adapter.capabilities.supportsCheckpoint,
          supportsRestore: adapter.capabilities.supportsRestore,
          supportsAttachHandoff: adapter.capabilities.supportsAttachHandoff,
          supportsResumeToken: adapter.capabilities.supportsResumeToken,
          supportsTranscript: adapter.capabilities.supportsTranscript,
          supportsFailedSnapshot: adapter.capabilities.supportsFailedSnapshot,
        },
      },
      {
        type: 'task.adapter.selected',
        message: adapterResolution.fallbackUsed
          ? `configured=${adapterResolution.configuredId}, resolved=${adapterResolution.resolvedId}`
          : adapterResolution.resolvedId,
      }
    )

    try {
      const prepared = await adapter.prepare(repoRoot, task)
      const startedAt = nowIso()
      const timeoutAt = new Date(Date.now() + timeoutMs).toISOString()
      await patchTask(
        repoRoot,
        task.id,
        {
          runtime: {
            preparedAt: startedAt,
            worktreePath: prepared.worktreePath,
            timeoutAt,
            retainedForDebug: false,
          },
        },
        {
          type: 'task.worker.prepared',
          message: prepared.worktreePath,
        }
      )

      const handle = await adapter.start(repoRoot, task, prepared)
      const checkpoint = await adapter.checkpoint(handle)
      const nextRuntime = appendRunStart(
        {
          ...(task.runtime ?? {}),
          preparedAt: startedAt,
          workerPid: handle.workerPid,
          worktreePath: handle.worktreePath,
          startedAt,
          timeoutAt,
          retainedForDebug: false,
        },
        {
          attempt: (task.runtime?.runAttempt ?? 0) + 1,
          runId: checkpoint.runId,
          status: 'started',
          startedAt,
          reason: 'new_task_start',
        }
      )

      await persistCheckpoint(
        task.id,
        nextRuntime,
        checkpoint,
        'task.worker.started',
        `pid=${handle.workerPid};run=${checkpoint.runId}`
      )
    } catch (error) {
      await updateTaskStatus(
        repoRoot,
        task.id,
        'failed',
        `Worker preparation/start failed: ${error}`
      )
      const maybeHandle = await buildRunHandle(task.id)
      if (maybeHandle) {
        try {
          await adapter.cleanup(repoRoot, maybeHandle)
        } catch {
          // Best effort cleanup.
        }
      }
    }
  }

  process.on('SIGTERM', () => {
    stopping = true
  })
  process.on('SIGINT', () => {
    stopping = true
  })

  state.status = 'running'

  await writeDaemonState(repoRoot, state)

  while (!stopping) {
    await reconcileTaskQueue(repoRoot)
    await handleRunningTasks()
    await startRunnableTasks()
    try {
      await dispatchConfiguredTaskSubscribers(repoRoot)
    } catch {
      // Subscriber dispatch must not crash scheduler.
    }
    const activeCount = await countActiveTasks(repoRoot)
    const now = Date.now()

    if (activeCount > 0) {
      state = {
        ...state,
        heartbeatAt: nowIso(),
        idleSince: null,
      }
    } else {
      const idleSince = state.idleSince ?? nowIso()
      state = {
        ...state,
        heartbeatAt: nowIso(),
        idleSince,
      }

      const idleMs = now - new Date(idleSince).getTime()
      if (idleMs >= idleStopMs) {
        stopping = true
        break
      }
    }

    await writeDaemonState(repoRoot, state)
    await new Promise(resolve => setTimeout(resolve, LOOP_POLL_MS))
  }

  state = {
    ...state,
    status: 'stopping',
    heartbeatAt: nowIso(),
  }
  await writeDaemonState(repoRoot, state)
}

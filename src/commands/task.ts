import { existsSync } from 'fs'
import { readFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import * as output from '../lib/output.ts'
import { detectWorktree } from '../lib/worktree.ts'
import { failWithError } from '../lib/cli.ts'
import {
  createTask,
  getTask,
  isTerminalTaskStatus,
  listTasks,
  patchTask,
  readTaskEvents,
  type PortTask,
  type PortTaskMode,
  updateTaskStatus,
} from '../lib/taskStore.ts'
import {
  cleanupTaskRuntime,
  ensureTaskDaemon,
  runTaskDaemon,
  stopTaskDaemon,
} from '../lib/taskDaemon.ts'
import { execFileAsync } from '../lib/exec.ts'
import {
  appendTaskStderr,
  appendTaskStdout,
  getTaskBundlePath,
  getTaskPatchPath,
  getTaskStderrPath,
  getTaskStdoutPath,
  hasTaskBundle,
  listTaskArtifactPaths,
  readTaskCommitRefs,
  writeTaskCommitRefs,
  writeTaskMetadata,
  writeTaskPatchFromWorktree,
} from '../lib/taskArtifacts.ts'
import { consumeGlobalTaskEvents, readGlobalTaskEvents } from '../lib/taskEventStream.ts'
import { resolveTaskAdapter } from '../lib/taskAdapterRegistry.ts'
import { resolveTaskRef } from '../lib/taskId.ts'

function getRepoRootOrFail(): string {
  try {
    return detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }
}

function taskDisplayLabel(task: Pick<PortTask, 'displayId'>): string {
  return `#${task.displayId}`
}

function taskReferenceLabel(task: Pick<PortTask, 'displayId' | 'id'>): string {
  return `${taskDisplayLabel(task)} (${task.id})`
}

function formatBlockedByReference(
  displayIdByTaskId: Map<string, number>,
  blockedByTaskId: string
): string {
  const displayId = displayIdByTaskId.get(blockedByTaskId)
  if (!displayId) {
    return blockedByTaskId
  }

  return `#${displayId}`
}

function resolveAttachOwnerId(): string {
  return process.env.USER ?? process.env.LOGNAME ?? 'unknown'
}

function isAttachLockActive(attachState?: PortTask['attach']): boolean {
  return (
    attachState?.state === 'pending_handoff' ||
    attachState?.state === 'handoff_ready' ||
    attachState?.state === 'client_attached' ||
    attachState?.state === 'reconnecting'
  )
}

async function resolveTaskOrFail(repoRoot: string, taskRef: string): Promise<PortTask> {
  const resolution = await resolveTaskRef(repoRoot, taskRef)

  if (resolution.ok) {
    return resolution.task
  }

  if (resolution.kind === 'ambiguous') {
    const candidates = [...resolution.candidates]
      .sort((left, right) => left.displayId - right.displayId)
      .map(candidate => taskReferenceLabel(candidate))
      .join(', ')
    failWithError(
      `Task id "${taskRef}" is ambiguous: ${candidates}; use a longer prefix or numeric id`
    )
  }

  failWithError(`Task not found: ${taskRef}`)
}

export async function taskStart(
  title: string,
  options: { mode?: PortTaskMode; branch?: string } = {}
): Promise<void> {
  if (!title.trim()) {
    failWithError('Task title must be a non-empty string')
  }

  const repoRoot = getRepoRootOrFail()
  const task = await createTask(repoRoot, {
    title: title.trim(),
    mode: options.mode,
    branch: options.branch,
  })

  await ensureTaskDaemon(repoRoot)

  output.success(`Queued ${output.branch(taskDisplayLabel(task))} (${task.mode})`)
  output.dim(task.id)
  output.dim(task.title)
}

export async function taskList(): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const tasks = await listTasks(repoRoot)

  if (tasks.length === 0) {
    output.info('No tasks found.')
    return
  }

  output.header('Tasks:')
  output.newline()

  const displayIdByTaskId = new Map(tasks.map(task => [task.id, task.displayId]))

  for (const task of tasks) {
    const attachState = task.attach?.state ? ` (${task.attach.state})` : ''
    const queueState = task.queue?.blockedByTaskId
      ? ` blocked-by=${formatBlockedByReference(displayIdByTaskId, task.queue.blockedByTaskId)}`
      : ''
    output.info(
      `${output.branch(taskDisplayLabel(task))} (${task.id})  ${task.status}${attachState}  ${task.mode}${queueState}  ${task.title}`
    )
  }
}

export async function taskRead(taskRef: string): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await resolveTaskOrFail(repoRoot, taskRef)

  output.header(`${output.branch(taskDisplayLabel(task))} (${task.status})`)
  output.newline()
  output.info(`Task: ${taskDisplayLabel(task)}`)
  output.info(`Internal ID: ${task.id}`)
  output.info(`Title: ${task.title}`)
  output.info(`Mode: ${task.mode}`)
  if (task.branch) {
    output.info(`Branch: ${task.branch}`)
  }
  output.info(`Adapter: ${task.adapter}`)
  output.info(
    `Caps: checkpoint=${task.capabilities.supportsCheckpoint ?? false}, restore=${task.capabilities.supportsRestore ?? false}, handoff=${task.capabilities.supportsAttachHandoff}, resumeToken=${task.capabilities.supportsResumeToken}`
  )
  if (task.queue?.lockKey) {
    output.info(`Queue lock: ${task.queue.lockKey}`)
  }
  if (task.queue?.blockedByTaskId) {
    const allTasks = await listTasks(repoRoot)
    const blocker = allTasks.find(candidate => candidate.id === task.queue?.blockedByTaskId)
    output.info(`Blocked by: ${blocker ? taskReferenceLabel(blocker) : task.queue.blockedByTaskId}`)
  }
  if (task.attach?.state) {
    output.info(`Attach state: ${task.attach.state}`)
  }
  if (task.runtime?.workerPid) {
    output.info(`Worker PID: ${task.runtime.workerPid}`)
  }
  if (task.runtime?.worktreePath) {
    output.info(`Worktree: ${task.runtime.worktreePath}`)
  }
  if (task.runtime?.timeoutAt) {
    output.info(`Timeout at: ${task.runtime.timeoutAt}`)
  }
  if (task.runtime?.runAttempt) {
    output.info(`Run attempt: ${task.runtime.runAttempt}`)
  }
  if (task.runtime?.checkpoint) {
    output.info(
      `Checkpoint: ${task.runtime.checkpoint.adapterId} (${task.runtime.checkpoint.runId})`
    )
  }
  if (task.runtime?.retainedForDebug) {
    output.info('Retained: true')
  }
  output.dim(`Created: ${task.createdAt}`)
  output.dim(`Updated: ${task.updatedAt}`)

  const events = await readTaskEvents(repoRoot, task.id, 10)
  if (events.length > 0) {
    output.newline()
    output.info('Recent events:')
    for (const event of events) {
      output.dim(`- ${event.at} ${event.type}${event.message ? ` - ${event.message}` : ''}`)
    }
  }
}

export async function taskArtifacts(taskId: string): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await resolveTaskOrFail(repoRoot, taskId)

  const paths = listTaskArtifactPaths(repoRoot, task.id)
  output.header(`Artifacts for ${output.branch(taskReferenceLabel(task))}:`)
  output.newline()
  for (const path of paths) {
    const status = existsSync(path) ? 'present' : 'missing'
    output.info(`${path} (${status})`)
  }
}

async function printTaskLogLines(path: string): Promise<void> {
  if (!existsSync(path)) {
    output.info('No log file found.')
    return
  }

  const content = await readFile(path, 'utf-8')
  const lines = content.split('\n').filter(Boolean)
  if (lines.length === 0) {
    output.info('Log is empty.')
    return
  }

  for (const line of lines) {
    output.info(line)
  }
}

export async function taskLogs(
  taskRef: string,
  options: { stderr?: boolean; follow?: boolean } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await resolveTaskOrFail(repoRoot, taskRef)

  const path = options.stderr
    ? getTaskStderrPath(repoRoot, task.id)
    : getTaskStdoutPath(repoRoot, task.id)
  await printTaskLogLines(path)

  if (!options.follow) {
    return
  }

  let previous = existsSync(path) ? await readFile(path, 'utf-8') : ''
  // Follow mode intentionally runs until interrupted.
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (!existsSync(path)) {
      continue
    }

    const next = await readFile(path, 'utf-8')
    if (next.length <= previous.length) {
      continue
    }

    const delta = next.slice(previous.length)
    for (const line of delta.split('\n').filter(Boolean)) {
      output.info(line)
    }
    previous = next
  }
}

export async function taskWait(
  taskRef: string,
  options: { timeoutSeconds?: number } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const initialTask = await resolveTaskOrFail(repoRoot, taskRef)
  const timeoutMs = (options.timeoutSeconds ?? 0) > 0 ? options.timeoutSeconds! * 1000 : null
  const startedAt = Date.now()

  while (true) {
    const task = await getTask(repoRoot, initialTask.id)
    if (!task) {
      failWithError(`Task not found: ${taskRef}`)
    }

    if (isTerminalTaskStatus(task.status)) {
      output.success(`Task ${output.branch(taskReferenceLabel(task))} is ${task.status}`)
      return
    }

    if (timeoutMs !== null && Date.now() - startedAt >= timeoutMs) {
      failWithError(`Timed out waiting for task ${taskReferenceLabel(initialTask)}`)
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

export async function taskResume(taskRef: string): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await resolveTaskOrFail(repoRoot, taskRef)

  if (isTerminalTaskStatus(task.status)) {
    output.info(
      `Task ${output.branch(taskReferenceLabel(task))} is terminal (${task.status}); use attach to revive it.`
    )
    return
  }

  if (task.status !== 'queued') {
    await updateTaskStatus(repoRoot, task.id, 'resuming', 'Resume requested by user')
  }

  await ensureTaskDaemon(repoRoot)
  output.success(`Resume requested for ${output.branch(taskReferenceLabel(task))}`)
}

export async function taskCancel(taskRef: string): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await resolveTaskOrFail(repoRoot, taskRef)

  if (isTerminalTaskStatus(task.status)) {
    output.info(`Task ${output.branch(taskReferenceLabel(task))} is already ${task.status}`)
    return
  }

  if (task.runtime?.workerPid) {
    try {
      process.kill(task.runtime.workerPid, 'SIGTERM')
    } catch {
      // Worker may already have exited.
    }
  }

  await patchTask(
    repoRoot,
    task.id,
    {
      runtime: {
        ...markRunTerminalRuntime(task.runtime ?? {}, 'cancelled', new Date().toISOString()),
        retainedForDebug: true,
      },
    },
    {
      type: 'task.cancelled',
      message: 'Cancelled by user command',
    }
  )
  await updateTaskStatus(repoRoot, task.id, 'cancelled', 'Cancelled by user command')
  output.success(`Cancelled ${output.branch(taskReferenceLabel(task))}`)
}

export async function taskWatch(options: { logs?: string; once?: boolean } = {}): Promise<void> {
  const repoRoot = getRepoRootOrFail()

  if (options.logs) {
    await taskLogs(options.logs, { follow: true })
    return
  }

  while (true) {
    const tasks = await listTasks(repoRoot)
    const displayIdByTaskId = new Map(tasks.map(task => [task.id, task.displayId]))
    output.header('Task watch:')
    output.newline()
    if (tasks.length === 0) {
      output.info('No tasks found.')
    } else {
      for (const task of tasks) {
        const queueState = task.queue?.blockedByTaskId
          ? ` blocked-by=${formatBlockedByReference(displayIdByTaskId, task.queue.blockedByTaskId)}`
          : ''
        output.info(
          `${output.branch(taskDisplayLabel(task))} (${task.id})  ${task.status}  ${task.mode}${queueState}  ${task.title}`
        )
      }
    }

    if (options.once) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
    output.newline()
  }
}

export async function taskEvents(
  options: { follow?: boolean; consumer?: string; once?: boolean } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  let fromLine = 0

  const printEvents = async (
    events: Awaited<ReturnType<typeof readGlobalTaskEvents>>['events']
  ) => {
    for (const event of events) {
      output.info(
        `${event.at} ${event.taskId} ${event.type}${event.message ? ` - ${event.message}` : ''}`
      )
    }
  }

  if (options.consumer) {
    await consumeGlobalTaskEvents(
      repoRoot,
      options.consumer,
      async event => {
        output.info(
          `${event.at} ${event.taskId} ${event.type}${event.message ? ` - ${event.message}` : ''}`
        )
      },
      { limit: 500 }
    )
  } else {
    const batch = await readGlobalTaskEvents(repoRoot, { fromLine, limit: 500 })
    await printEvents(batch.events)
    fromLine = batch.nextLine
  }

  if (!options.follow) {
    return
  }

  while (true) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (options.consumer) {
      await consumeGlobalTaskEvents(
        repoRoot,
        options.consumer,
        async event => {
          output.info(
            `${event.at} ${event.taskId} ${event.type}${event.message ? ` - ${event.message}` : ''}`
          )
        },
        { limit: 500 }
      )
    } else {
      const batch = await readGlobalTaskEvents(repoRoot, { fromLine, limit: 500 })
      await printEvents(batch.events)
      fromLine = batch.nextLine
    }

    if (options.once) {
      return
    }
  }
}

export async function taskCleanup(): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const stopped = await stopTaskDaemon(repoRoot)

  if (stopped.reason === 'active_tasks') {
    output.warn('Daemon still has active tasks; skipping shutdown.')
    return
  }

  if (stopped.reason === 'stopped') {
    output.success('Stopped task daemon')
  }

  const tasks = await listTasks(repoRoot)
  const taskIds = new Set(tasks.map(task => task.id))
  const artifactsRoot = join(repoRoot, '.port', 'jobs', 'artifacts')
  if (existsSync(artifactsRoot)) {
    const entries = await readdir(artifactsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      if (!taskIds.has(entry.name)) {
        await rm(join(artifactsRoot, entry.name), { recursive: true, force: true })
      }
    }
  }

  await cleanupTaskRuntime(repoRoot)
  output.success('Cleaned task runtime state and garbage-collected orphan artifacts')
}

export async function taskDaemon(options: { serve?: boolean; repo?: string }): Promise<void> {
  if (!options.serve) {
    failWithError('Use internal mode: port task daemon --serve --repo <path>')
  }

  const repoRoot = options.repo ?? getRepoRootOrFail()
  await runTaskDaemon(repoRoot)
}

async function ensureCleanWorkingTree(repoRoot: string): Promise<void> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoRoot })
  if (stdout.trim().length > 0) {
    failWithError('Working tree is not clean. Commit or stash changes before applying task output.')
  }
}

async function applyByCherryPick(
  repoRoot: string,
  taskId: string,
  options: { squash: boolean }
): Promise<boolean> {
  const commits = await readTaskCommitRefs(repoRoot, taskId)
  if (commits.length === 0) {
    return false
  }

  if (options.squash) {
    for (const commit of commits) {
      await execFileAsync('git', ['cherry-pick', '--no-commit', commit], { cwd: repoRoot })
    }
    await execFileAsync('git', ['commit', '-m', `Apply task ${taskId}`], { cwd: repoRoot })
    return true
  }

  for (const commit of commits) {
    await execFileAsync('git', ['cherry-pick', commit], { cwd: repoRoot })
  }

  return true
}

async function applyByBundle(
  repoRoot: string,
  taskId: string,
  options: { squash: boolean }
): Promise<boolean> {
  if (!hasTaskBundle(repoRoot, taskId)) {
    return false
  }

  const bundlePath = getTaskBundlePath(repoRoot, taskId)
  await execFileAsync('git', ['bundle', 'verify', bundlePath], { cwd: repoRoot })

  // Current worker path does not emit bundle refs yet, but this keeps the fallback chain intact.
  const commits = await readTaskCommitRefs(repoRoot, taskId)
  if (commits.length === 0) {
    return false
  }

  if (options.squash) {
    for (const commit of commits) {
      await execFileAsync('git', ['cherry-pick', '--no-commit', commit], { cwd: repoRoot })
    }
    await execFileAsync('git', ['commit', '-m', `Apply task ${taskId}`], { cwd: repoRoot })
    return true
  }

  for (const commit of commits) {
    await execFileAsync('git', ['cherry-pick', commit], { cwd: repoRoot })
  }
  return true
}

async function applyByPatch(repoRoot: string, taskId: string): Promise<boolean> {
  const patchPath = getTaskPatchPath(repoRoot, taskId)
  await execFileAsync('git', ['apply', '--3way', patchPath], { cwd: repoRoot })
  return true
}

export async function taskApply(
  taskRef: string,
  options: { method?: 'auto' | 'cherry-pick' | 'bundle' | 'patch'; squash?: boolean } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await resolveTaskOrFail(repoRoot, taskRef)
  const taskId = task.id

  await ensureCleanWorkingTree(repoRoot)

  const method = options.method ?? 'auto'
  const squash = options.squash ?? false

  if (method === 'cherry-pick') {
    const applied = await applyByCherryPick(repoRoot, taskId, { squash })
    if (!applied) {
      failWithError(`No commit refs available for task ${taskId}`)
    }
    output.success(`Applied task ${output.branch(taskReferenceLabel(task))} via cherry-pick`)
    return
  }

  if (method === 'bundle') {
    const applied = await applyByBundle(repoRoot, taskId, { squash })
    if (!applied) {
      failWithError(`No bundle-backed commit refs available for task ${taskId}`)
    }
    output.success(`Applied task ${output.branch(taskReferenceLabel(task))} via bundle`)
    return
  }

  if (method === 'patch') {
    await applyByPatch(repoRoot, taskId)
    output.success(`Applied task ${output.branch(taskReferenceLabel(task))} via patch`)
    return
  }

  if (await applyByCherryPick(repoRoot, taskId, { squash })) {
    output.success(`Applied task ${output.branch(taskReferenceLabel(task))} via cherry-pick`)
    return
  }

  if (await applyByBundle(repoRoot, taskId, { squash })) {
    output.success(`Applied task ${output.branch(taskReferenceLabel(task))} via bundle`)
    return
  }

  await applyByPatch(repoRoot, taskId)
  output.success(`Applied task ${output.branch(taskReferenceLabel(task))} via patch`)
}

function parseSleepHint(title: string): number {
  const match = title.match(/\[sleep=(\d+)\]/)
  if (!match?.[1]) {
    return 750
  }

  const parsed = Number.parseInt(match[1], 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return 750
  }

  return parsed
}

function markRunTerminalRuntime(
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

function appendContinuationRunRuntime(
  runtime: NonNullable<PortTask['runtime']>,
  options: {
    runId: string
    reason: string
    startedAt: string
    workerPid: number
    worktreePath: string
  }
): NonNullable<PortTask['runtime']> {
  const attempt = (runtime.runAttempt ?? 0) + 1
  return {
    ...runtime,
    runAttempt: attempt,
    activeRunId: options.runId,
    workerPid: options.workerPid,
    worktreePath: options.worktreePath,
    startedAt: options.startedAt,
    retainedForDebug: false,
    runs: [
      ...(runtime.runs ?? []),
      {
        attempt,
        runId: options.runId,
        status: 'restored',
        startedAt: options.startedAt,
        reason: options.reason,
      },
    ],
  }
}

export async function taskAttach(
  taskRef: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await resolveTaskOrFail(repoRoot, taskRef)
  const ownerId = resolveAttachOwnerId()
  const currentAttach = task.attach
  const currentOwner = currentAttach?.lockOwner
  const lockIsActive = isAttachLockActive(currentAttach)

  if (currentOwner && currentOwner !== ownerId && lockIsActive && !options.force) {
    const sessionLabel = currentAttach?.sessionHandle ?? 'unknown'
    failWithError(
      `Task ${taskReferenceLabel(task)} attach lock is held by ${currentOwner} (session ${sessionLabel}); retry with --force to take over`
    )
  }

  if (!task.runtime?.checkpoint) {
    failWithError(
      `Task ${taskReferenceLabel(task)} does not have checkpoint data required for attach revival`
    )
  }

  const scriptPath = process.argv[1]
  if (!scriptPath) {
    failWithError('Unable to resolve CLI entrypoint for attach revive')
  }

  const resolved = await resolveTaskAdapter(repoRoot, scriptPath)
  const adapter = resolved.adapter

  if (!adapter.capabilities.supportsRestore) {
    failWithError(`Adapter ${adapter.id} does not support restore for attach`)
  }

  await updateTaskStatus(
    repoRoot,
    task.id,
    'reviving_for_attach',
    'Attach requested; reviving task'
  )

  if (currentOwner && currentOwner !== ownerId && lockIsActive && options.force) {
    await patchTask(
      repoRoot,
      task.id,
      {
        attach: {
          ...(task.attach ?? {}),
          state: 'revoked',
          lockOwner: ownerId,
        },
      },
      {
        type: 'task.attach.revoked',
        message: `previous_owner=${currentOwner};new_owner=${ownerId}`,
      }
    )
  }

  await patchTask(
    repoRoot,
    task.id,
    {
      attach: {
        ...(task.attach ?? {}),
        state: 'pending_handoff',
        lockOwner: ownerId,
      },
    },
    {
      type: 'task.attach.revive_started',
      message: `adapter=${adapter.id}`,
    }
  )

  try {
    const restoredHandle = await adapter.restore(repoRoot, task, task.runtime.checkpoint)
    const checkpoint = await adapter.checkpoint(restoredHandle)
    const startedAt = new Date().toISOString()

    const latest = await getTask(repoRoot, task.id)
    const runtime = appendContinuationRunRuntime(latest?.runtime ?? task.runtime, {
      runId: checkpoint.runId,
      reason: 'attach_revival',
      startedAt,
      workerPid: restoredHandle.workerPid,
      worktreePath: restoredHandle.worktreePath,
    })

    await patchTask(
      repoRoot,
      task.id,
      {
        runtime: {
          ...runtime,
          checkpoint,
          checkpointHistory: [...(runtime.checkpointHistory ?? []), checkpoint],
        },
        attach: {
          ...(latest?.attach ?? task.attach ?? {}),
          state: 'client_attached',
          sessionHandle: checkpoint.runId,
          lockOwner: ownerId,
        },
      },
      {
        type: 'task.attach.revive_succeeded',
        message: `run=${checkpoint.runId}`,
      }
    )

    if (adapter.capabilities.supportsAttachHandoff) {
      const handoff = await adapter.requestHandoff(restoredHandle)
      const context = await adapter.attachContext(restoredHandle)

      await patchTask(
        repoRoot,
        task.id,
        {
          attach: {
            ...(latest?.attach ?? task.attach ?? {}),
            state: 'handoff_ready',
            sessionHandle: context.sessionHandle,
            checkpointId: context.checkpointRunId,
            resumeTokenExpiresAt: context.resumeToken?.expiresAt,
            lockOwner: ownerId,
          },
        },
        {
          type: 'task.attach.handoff_ready',
          message: `session=${context.sessionHandle};boundary=${handoff.boundary}`,
        }
      )

      await updateTaskStatus(repoRoot, task.id, 'paused_for_attach', 'Attach handoff ready')
      output.success(
        `Attach handoff ready for ${output.branch(taskReferenceLabel(task))} at ${handoff.boundary}`
      )
      output.info(`Restore strategy: ${context.restoreStrategy}`)
      if (context.transcriptPath) {
        output.dim(`Transcript: ${context.transcriptPath}`)
      }
      return
    }

    await updateTaskStatus(repoRoot, task.id, 'running', 'Revived for attach')
    output.success(
      `Revived ${output.branch(taskReferenceLabel(task))} and attached continuation run ${checkpoint.runId}`
    )
    output.info(
      'Interactive attach handoff UI is not implemented yet; task continues in background.'
    )
  } catch (error) {
    await patchTask(
      repoRoot,
      task.id,
      {
        attach: {
          ...(task.attach ?? {}),
          state: 'detached',
          lockOwner: undefined,
          sessionHandle: undefined,
        },
      },
      {
        type: 'task.attach.revive_failed',
        message: `${error}`,
      }
    )
    await updateTaskStatus(repoRoot, task.id, 'resume_failed', `Attach revive failed: ${error}`)
    failWithError(`Failed to revive task ${taskReferenceLabel(task)} for attach: ${error}`)
  }
}

export async function taskWorker(options: {
  taskId: string
  repo: string
  worktree: string
}): Promise<void> {
  const task = await getTask(options.repo, options.taskId)
  if (!task) {
    failWithError(`Task not found: ${options.taskId}`)
  }

  await updateTaskStatus(options.repo, options.taskId, 'running', 'Worker started')
  await appendTaskStdout(options.repo, options.taskId, 'worker:started')

  try {
    const sleepMs = parseSleepHint(task.title)

    // Validate worktree git context and simulate deterministic execution.
    await execFileAsync('git', ['status', '--short'], { cwd: options.worktree })
    await new Promise(resolve => setTimeout(resolve, sleepMs))

    if (task.title.includes('[fail]')) {
      throw new Error('Task requested failure via [fail] marker')
    }

    if (task.mode === 'write' && task.title.includes('[edit]')) {
      await execFileAsync('git', ['status', '--short'], { cwd: options.worktree })
    }

    const latestTaskForSuccess = await getTask(options.repo, options.taskId)

    await patchTask(
      options.repo,
      options.taskId,
      {
        runtime: {
          ...markRunTerminalRuntime(
            latestTaskForSuccess?.runtime ?? task.runtime ?? {},
            'completed',
            new Date().toISOString()
          ),
          lastExitCode: 0,
        },
      },
      {
        type: 'task.worker.finished',
        message: 'Worker exited successfully',
      }
    )
    await updateTaskStatus(
      options.repo,
      options.taskId,
      'completed',
      'Worker completed successfully'
    )
    await appendTaskStdout(options.repo, options.taskId, 'worker:completed')
  } catch (error) {
    await appendTaskStderr(options.repo, options.taskId, `worker:error ${error}`)
    const latestTaskForFailure = await getTask(options.repo, options.taskId)
    await patchTask(
      options.repo,
      options.taskId,
      {
        runtime: {
          ...markRunTerminalRuntime(
            latestTaskForFailure?.runtime ?? task.runtime ?? {},
            'failed',
            new Date().toISOString()
          ),
          lastExitCode: 1,
          retainedForDebug: true,
        },
      },
      {
        type: 'task.worker.failed',
        message: `${error}`,
      }
    )
    await updateTaskStatus(options.repo, options.taskId, 'failed', `Worker failed: ${error}`)
    throw error
  } finally {
    const finalTask = await getTask(options.repo, options.taskId)
    if (finalTask?.mode === 'write') {
      await writeTaskCommitRefs(options.repo, options.taskId, [])
      await writeTaskPatchFromWorktree(options.repo, options.taskId, options.worktree)
      await writeTaskMetadata(options.repo, finalTask)
    }
  }
}

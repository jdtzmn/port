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

function getRepoRootOrFail(): string {
  try {
    return detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }
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

  output.success(`Queued ${output.branch(task.id)} (${task.mode})`)
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

  for (const task of tasks) {
    const attachState = task.attach?.state ? ` (${task.attach.state})` : ''
    const queueState = task.queue?.blockedByTaskId
      ? ` blocked-by=${task.queue.blockedByTaskId}`
      : ''
    output.info(
      `${output.branch(task.id)}  ${task.status}${attachState}  ${task.mode}${queueState}  ${task.title}`
    )
  }
}

export async function taskRead(taskId: string): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await getTask(repoRoot, taskId)

  if (!task) {
    failWithError(`Task not found: ${taskId}`)
  }

  output.header(`${output.branch(task.id)} (${task.status})`)
  output.newline()
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
    output.info(`Blocked by: ${task.queue.blockedByTaskId}`)
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

  const events = await readTaskEvents(repoRoot, taskId, 10)
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
  const task = await getTask(repoRoot, taskId)
  if (!task) {
    failWithError(`Task not found: ${taskId}`)
  }

  const paths = listTaskArtifactPaths(repoRoot, taskId)
  output.header(`Artifacts for ${output.branch(taskId)}:`)
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
  taskId: string,
  options: { stderr?: boolean; follow?: boolean } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await getTask(repoRoot, taskId)
  if (!task) {
    failWithError(`Task not found: ${taskId}`)
  }

  const path = options.stderr
    ? getTaskStderrPath(repoRoot, taskId)
    : getTaskStdoutPath(repoRoot, taskId)
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
  taskId: string,
  options: { timeoutSeconds?: number } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const timeoutMs = (options.timeoutSeconds ?? 0) > 0 ? options.timeoutSeconds! * 1000 : null
  const startedAt = Date.now()

  while (true) {
    const task = await getTask(repoRoot, taskId)
    if (!task) {
      failWithError(`Task not found: ${taskId}`)
    }

    if (isTerminalTaskStatus(task.status)) {
      output.success(`Task ${output.branch(task.id)} is ${task.status}`)
      return
    }

    if (timeoutMs !== null && Date.now() - startedAt >= timeoutMs) {
      failWithError(`Timed out waiting for task ${taskId}`)
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

export async function taskResume(taskId: string): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await getTask(repoRoot, taskId)
  if (!task) {
    failWithError(`Task not found: ${taskId}`)
  }

  if (isTerminalTaskStatus(task.status)) {
    output.info(
      `Task ${output.branch(task.id)} is terminal (${task.status}); use attach to revive it.`
    )
    return
  }

  if (task.status !== 'queued') {
    await updateTaskStatus(repoRoot, task.id, 'resuming', 'Resume requested by user')
  }

  await ensureTaskDaemon(repoRoot)
  output.success(`Resume requested for ${output.branch(task.id)}`)
}

export async function taskCancel(taskId: string): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await getTask(repoRoot, taskId)
  if (!task) {
    failWithError(`Task not found: ${taskId}`)
  }

  if (isTerminalTaskStatus(task.status)) {
    output.info(`Task ${output.branch(task.id)} is already ${task.status}`)
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
        ...(task.runtime ?? {}),
        finishedAt: new Date().toISOString(),
        retainedForDebug: true,
      },
    },
    {
      type: 'task.cancelled',
      message: 'Cancelled by user command',
    }
  )
  await updateTaskStatus(repoRoot, task.id, 'cancelled', 'Cancelled by user command')
  output.success(`Cancelled ${output.branch(task.id)}`)
}

export async function taskWatch(options: { logs?: string; once?: boolean } = {}): Promise<void> {
  const repoRoot = getRepoRootOrFail()

  if (options.logs) {
    await taskLogs(options.logs, { follow: true })
    return
  }

  while (true) {
    const tasks = await listTasks(repoRoot)
    output.header('Task watch:')
    output.newline()
    if (tasks.length === 0) {
      output.info('No tasks found.')
    } else {
      for (const task of tasks) {
        const queueState = task.queue?.blockedByTaskId
          ? ` blocked-by=${task.queue.blockedByTaskId}`
          : ''
        output.info(
          `${output.branch(task.id)}  ${task.status}  ${task.mode}${queueState}  ${task.title}`
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
  taskId: string,
  options: { method?: 'auto' | 'cherry-pick' | 'bundle' | 'patch'; squash?: boolean } = {}
): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const task = await getTask(repoRoot, taskId)
  if (!task) {
    failWithError(`Task not found: ${taskId}`)
  }

  await ensureCleanWorkingTree(repoRoot)

  const method = options.method ?? 'auto'
  const squash = options.squash ?? false

  if (method === 'cherry-pick') {
    const applied = await applyByCherryPick(repoRoot, taskId, { squash })
    if (!applied) {
      failWithError(`No commit refs available for task ${taskId}`)
    }
    output.success(`Applied task ${output.branch(taskId)} via cherry-pick`)
    return
  }

  if (method === 'bundle') {
    const applied = await applyByBundle(repoRoot, taskId, { squash })
    if (!applied) {
      failWithError(`No bundle-backed commit refs available for task ${taskId}`)
    }
    output.success(`Applied task ${output.branch(taskId)} via bundle`)
    return
  }

  if (method === 'patch') {
    await applyByPatch(repoRoot, taskId)
    output.success(`Applied task ${output.branch(taskId)} via patch`)
    return
  }

  if (await applyByCherryPick(repoRoot, taskId, { squash })) {
    output.success(`Applied task ${output.branch(taskId)} via cherry-pick`)
    return
  }

  if (await applyByBundle(repoRoot, taskId, { squash })) {
    output.success(`Applied task ${output.branch(taskId)} via bundle`)
    return
  }

  await applyByPatch(repoRoot, taskId)
  output.success(`Applied task ${output.branch(taskId)} via patch`)
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

    await patchTask(
      options.repo,
      options.taskId,
      {
        runtime: {
          ...(task.runtime ?? {}),
          finishedAt: new Date().toISOString(),
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
    await patchTask(
      options.repo,
      options.taskId,
      {
        runtime: {
          ...(task.runtime ?? {}),
          finishedAt: new Date().toISOString(),
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

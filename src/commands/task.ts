import * as output from '../lib/output.ts'
import { detectWorktree } from '../lib/worktree.ts'
import { failWithError } from '../lib/cli.ts'
import {
  createTask,
  getTask,
  listTasks,
  patchTask,
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
    `Attach caps: handoff=${task.capabilities.supportsAttachHandoff}, resumeToken=${task.capabilities.supportsResumeToken}`
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
  if (task.runtime?.retainedForDebug) {
    output.info('Retained: true')
  }
  output.dim(`Created: ${task.createdAt}`)
  output.dim(`Updated: ${task.updatedAt}`)
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

  await cleanupTaskRuntime(repoRoot)
  output.success('Cleaned task runtime state')
}

export async function taskDaemon(options: { serve?: boolean; repo?: string }): Promise<void> {
  if (!options.serve) {
    failWithError('Use internal mode: port task daemon --serve --repo <path>')
  }

  const repoRoot = options.repo ?? getRepoRootOrFail()
  await runTaskDaemon(repoRoot)
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

  try {
    const sleepMs = parseSleepHint(task.title)

    // Validate worktree git context and simulate deterministic execution.
    await execFileAsync('git', ['status', '--short'], { cwd: options.worktree })
    await new Promise(resolve => setTimeout(resolve, sleepMs))

    if (task.title.includes('[fail]')) {
      throw new Error('Task requested failure via [fail] marker')
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
  } catch (error) {
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
  }
}

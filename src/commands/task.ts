import * as output from '../lib/output.ts'
import { detectWorktree } from '../lib/worktree.ts'
import { failWithError } from '../lib/cli.ts'
import { createTask, getTask, listTasks, type PortTaskMode } from '../lib/taskStore.ts'
import {
  cleanupTaskRuntime,
  ensureTaskDaemon,
  runTaskDaemon,
  stopTaskDaemon,
} from '../lib/taskDaemon.ts'

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
  output.dim(`Created: ${task.createdAt}`)
  output.dim(`Updated: ${task.updatedAt}`)
}

export async function taskCleanup(): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const stopped = await stopTaskDaemon(repoRoot)

  if (stopped.reason === 'active_tasks') {
    output.warn('Daemon still has active tasks; skipping shutdown.')
  } else if (stopped.reason === 'stopped') {
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

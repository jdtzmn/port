import { appendFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { withFileLock, writeFileAtomic } from './state.ts'

export type PortTaskStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'paused_for_attach'
  | 'resume_failed'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'cleaned'

export type PortTaskMode = 'read' | 'write'

export interface PortTask {
  id: string
  title: string
  mode: PortTaskMode
  status: PortTaskStatus
  branch?: string
  adapter: string
  capabilities: {
    supportsAttachHandoff: boolean
    supportsResumeToken: boolean
    supportsTranscript: boolean
    supportsFailedSnapshot: boolean
  }
  attach?: {
    state?:
      | 'pending_handoff'
      | 'handoff_ready'
      | 'client_attached'
      | 'reconnecting'
      | 'detached'
      | 'revoked'
    lockOwner?: string
    sessionHandle?: string
    checkpointId?: string
    resumeTokenExpiresAt?: string
  }
  createdAt: string
  updatedAt: string
}

export interface PortTaskEvent {
  id: string
  taskId: string
  type: string
  at: string
  message?: string
}

interface TaskIndex {
  version: 2
  tasks: PortTask[]
}

const JOBS_DIR = 'jobs'
const EVENTS_DIR = 'events'
const RUNTIME_DIR = 'runtime'
const INDEX_FILE = 'index.json'
const INDEX_LOCK_FILE = 'index.lock'

function nowIso(): string {
  return new Date().toISOString()
}

function getJobsDir(repoRoot: string): string {
  return join(repoRoot, '.port', JOBS_DIR)
}

function getEventsDir(repoRoot: string): string {
  return join(getJobsDir(repoRoot), EVENTS_DIR)
}

export function getTaskRuntimeDir(repoRoot: string): string {
  return join(getJobsDir(repoRoot), RUNTIME_DIR)
}

function getTaskIndexPath(repoRoot: string): string {
  return join(getJobsDir(repoRoot), INDEX_FILE)
}

function getTaskIndexLockPath(repoRoot: string): string {
  return join(getJobsDir(repoRoot), INDEX_LOCK_FILE)
}

function getTaskEventPath(repoRoot: string, taskId: string): string {
  return join(getEventsDir(repoRoot), `${taskId}.jsonl`)
}

async function readTaskIndex(repoRoot: string): Promise<TaskIndex> {
  const indexPath = getTaskIndexPath(repoRoot)

  if (!existsSync(indexPath)) {
    return { version: 2, tasks: [] }
  }

  try {
    const content = await readFile(indexPath, 'utf-8')
    const parsed = JSON.parse(content) as {
      version?: number
      tasks?: PortTask[]
    }

    if (!Array.isArray(parsed.tasks)) {
      return { version: 2, tasks: [] }
    }

    if (parsed.version !== 1 && parsed.version !== 2) {
      return { version: 2, tasks: [] }
    }

    const migratedTasks = parsed.tasks.map(task => ({
      ...task,
      adapter: task.adapter ?? 'local',
      capabilities: {
        supportsAttachHandoff: task.capabilities?.supportsAttachHandoff ?? false,
        supportsResumeToken: task.capabilities?.supportsResumeToken ?? false,
        supportsTranscript: task.capabilities?.supportsTranscript ?? false,
        supportsFailedSnapshot: task.capabilities?.supportsFailedSnapshot ?? false,
      },
    }))

    return { version: 2, tasks: migratedTasks }
  } catch {
    return { version: 2, tasks: [] }
  }
}

async function writeTaskIndex(repoRoot: string, index: TaskIndex): Promise<void> {
  const indexPath = getTaskIndexPath(repoRoot)
  await writeFileAtomic(indexPath, `${JSON.stringify(index, null, 2)}\n`)
}

async function appendTaskEvent(repoRoot: string, event: PortTaskEvent): Promise<void> {
  const eventPath = getTaskEventPath(repoRoot, event.taskId)
  await appendFile(eventPath, `${JSON.stringify(event)}\n`)
}

export async function ensureTaskStorage(repoRoot: string): Promise<void> {
  await mkdir(getJobsDir(repoRoot), { recursive: true })
  await mkdir(getEventsDir(repoRoot), { recursive: true })
  await mkdir(getTaskRuntimeDir(repoRoot), { recursive: true })
}

export async function createTask(
  repoRoot: string,
  input: { title: string; mode?: PortTaskMode; branch?: string }
): Promise<PortTask> {
  await ensureTaskStorage(repoRoot)
  const lockPath = getTaskIndexLockPath(repoRoot)

  return withFileLock(lockPath, async () => {
    const index = await readTaskIndex(repoRoot)
    const timestamp = nowIso()
    const task: PortTask = {
      id: `task-${randomUUID().slice(0, 8)}`,
      title: input.title,
      mode: input.mode ?? 'write',
      status: 'queued',
      branch: input.branch,
      adapter: 'local',
      capabilities: {
        supportsAttachHandoff: false,
        supportsResumeToken: false,
        supportsTranscript: false,
        supportsFailedSnapshot: false,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    index.tasks.push(task)
    await writeTaskIndex(repoRoot, index)
    await appendTaskEvent(repoRoot, {
      id: randomUUID(),
      taskId: task.id,
      type: 'task.created',
      at: timestamp,
      message: task.title,
    })

    return task
  })
}

export async function listTasks(repoRoot: string): Promise<PortTask[]> {
  await ensureTaskStorage(repoRoot)
  const index = await readTaskIndex(repoRoot)
  return [...index.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getTask(repoRoot: string, taskId: string): Promise<PortTask | null> {
  const tasks = await listTasks(repoRoot)
  return tasks.find(task => task.id === taskId) ?? null
}

export async function updateTaskStatus(
  repoRoot: string,
  taskId: string,
  status: PortTaskStatus,
  message?: string
): Promise<PortTask | null> {
  await ensureTaskStorage(repoRoot)
  const lockPath = getTaskIndexLockPath(repoRoot)

  return withFileLock(lockPath, async () => {
    const index = await readTaskIndex(repoRoot)
    const task = index.tasks.find(item => item.id === taskId)

    if (!task) {
      return null
    }

    task.status = status
    task.updatedAt = nowIso()

    await writeTaskIndex(repoRoot, index)
    await appendTaskEvent(repoRoot, {
      id: randomUUID(),
      taskId,
      type: `task.${status}`,
      at: task.updatedAt,
      message,
    })

    return task
  })
}

export async function countActiveTasks(repoRoot: string): Promise<number> {
  const tasks = await listTasks(repoRoot)
  return tasks.filter(task => {
    return (
      task.status === 'queued' ||
      task.status === 'preparing' ||
      task.status === 'running' ||
      task.status === 'paused_for_attach' ||
      task.status === 'resume_failed'
    )
  }).length
}

import { appendFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { withFileLock, writeFileAtomic } from './state.ts'
import { appendGlobalTaskEvent } from './taskEventStream.ts'
import type { TaskCheckpointRef } from './taskAdapter.ts'

export type PortTaskStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'resuming'
  | 'reviving_for_attach'
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
  displayId: number
  title: string
  mode: PortTaskMode
  status: PortTaskStatus
  branch?: string
  worker?: string
  adapter: string
  capabilities: {
    supportsCheckpoint?: boolean
    supportsRestore?: boolean
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
  queue?: {
    lockKey?: string
    blockedByTaskId?: string
  }
  runtime?: {
    runAttempt?: number
    activeRunId?: string
    runs?: Array<{
      attempt: number
      runId: string
      status: 'started' | 'restored' | 'completed' | 'failed' | 'timeout' | 'cancelled'
      startedAt: string
      finishedAt?: string
      reason?: string
    }>
    workerPid?: number
    worktreePath?: string
    timeoutAt?: string
    preparedAt?: string
    startedAt?: string
    finishedAt?: string
    cleanedAt?: string
    retainedForDebug?: boolean
    lastExitCode?: number
    checkpoint?: TaskCheckpointRef
    checkpointHistory?: TaskCheckpointRef[]
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
  version: 3
  nextDisplayId: number
  tasks: PortTask[]
}

interface ReadTaskIndexResult {
  index: TaskIndex
  migrated: boolean
}

type MigratingTask = Omit<PortTask, 'displayId'> & { displayId?: number }

const ACTIVE_TASK_STATUSES = new Set<PortTaskStatus>([
  'queued',
  'preparing',
  'running',
  'resuming',
  'reviving_for_attach',
  'paused_for_attach',
  'resume_failed',
])

const TERMINAL_TASK_STATUSES = new Set<PortTaskStatus>([
  'completed',
  'failed',
  'timeout',
  'cancelled',
  'cleaned',
])

const JOBS_DIR = 'jobs'
const EVENTS_DIR = 'events'
const RUNTIME_DIR = 'runtime'
const INDEX_FILE = 'index.json'
const INDEX_LOCK_FILE = 'index.lock'

function nowIso(): string {
  return new Date().toISOString()
}

function isValidDisplayId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function normalizeTaskRecord(raw: unknown): { task: MigratingTask; migrated: boolean } {
  const source = (raw ?? {}) as Partial<PortTask>
  let migrated = false

  const id = typeof source.id === 'string' ? source.id : `task-${randomUUID().slice(0, 8)}`
  if (typeof source.id !== 'string') {
    migrated = true
  }

  const title = typeof source.title === 'string' ? source.title : 'Untitled task'
  if (typeof source.title !== 'string') {
    migrated = true
  }

  const mode: PortTaskMode =
    source.mode === 'read' || source.mode === 'write' ? source.mode : 'write'
  if (source.mode !== mode) {
    migrated = true
  }

  const status = source.status
  const normalizedStatus: PortTaskStatus =
    status &&
    [
      'queued',
      'preparing',
      'running',
      'resuming',
      'reviving_for_attach',
      'paused_for_attach',
      'resume_failed',
      'completed',
      'failed',
      'timeout',
      'cancelled',
      'cleaned',
    ].includes(status)
      ? (status as PortTaskStatus)
      : 'queued'
  if (status !== normalizedStatus) {
    migrated = true
  }

  const createdAt = typeof source.createdAt === 'string' ? source.createdAt : nowIso()
  if (typeof source.createdAt !== 'string') {
    migrated = true
  }

  const updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : createdAt
  if (typeof source.updatedAt !== 'string') {
    migrated = true
  }

  const branch = typeof source.branch === 'string' ? source.branch : undefined
  if (source.branch !== undefined && typeof source.branch !== 'string') {
    migrated = true
  }

  const adapter = typeof source.adapter === 'string' ? source.adapter : 'local'
  if (typeof source.adapter !== 'string') {
    migrated = true
  }

  const caps = source.capabilities
  const capabilities = {
    supportsCheckpoint: caps?.supportsCheckpoint ?? false,
    supportsRestore: caps?.supportsRestore ?? false,
    supportsAttachHandoff: caps?.supportsAttachHandoff ?? false,
    supportsResumeToken: caps?.supportsResumeToken ?? false,
    supportsTranscript: caps?.supportsTranscript ?? false,
    supportsFailedSnapshot: caps?.supportsFailedSnapshot ?? false,
  }
  if (
    !caps ||
    caps.supportsCheckpoint === undefined ||
    caps.supportsRestore === undefined ||
    caps.supportsAttachHandoff === undefined ||
    caps.supportsResumeToken === undefined ||
    caps.supportsTranscript === undefined ||
    caps.supportsFailedSnapshot === undefined
  ) {
    migrated = true
  }

  const task: MigratingTask = {
    id,
    displayId: isValidDisplayId(source.displayId) ? source.displayId : undefined,
    title,
    mode,
    status: normalizedStatus,
    branch,
    adapter,
    capabilities,
    attach: source.attach,
    queue: source.queue,
    runtime: source.runtime,
    createdAt,
    updatedAt,
  }

  if (source.displayId !== undefined && !isValidDisplayId(source.displayId)) {
    migrated = true
  }

  return { task, migrated }
}

function normalizeTaskIndex(raw: unknown): ReadTaskIndexResult {
  const parsed = (raw ?? {}) as {
    version?: number
    nextDisplayId?: unknown
    tasks?: unknown
  }

  if (!Array.isArray(parsed.tasks)) {
    return {
      index: {
        version: 3,
        nextDisplayId: 1,
        tasks: [],
      },
      migrated: parsed.version !== undefined,
    }
  }

  const normalized = parsed.tasks.map(record => normalizeTaskRecord(record))
  const tasks: MigratingTask[] = normalized.map(entry => entry.task)
  let migrated = parsed.version !== 3 || normalized.some(entry => entry.migrated)

  let maxDisplayId = 0
  for (const task of tasks) {
    if (isValidDisplayId(task.displayId)) {
      maxDisplayId = Math.max(maxDisplayId, task.displayId)
    }
  }

  let nextAssignedDisplayId = maxDisplayId + 1
  const missingDisplayIds = tasks
    .filter(task => !isValidDisplayId(task.displayId))
    .sort((left, right) => {
      const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
      if (byCreatedAt !== 0) {
        return byCreatedAt
      }
      return left.id.localeCompare(right.id)
    })

  for (const task of missingDisplayIds) {
    task.displayId = nextAssignedDisplayId
    nextAssignedDisplayId += 1
    migrated = true
  }

  const finalizedTasks: PortTask[] = tasks.map(task => ({
    ...task,
    displayId: task.displayId ?? 1,
  }))

  maxDisplayId = finalizedTasks.reduce((maxId, task) => Math.max(maxId, task.displayId), 0)
  const parsedNextDisplayId = isValidDisplayId(parsed.nextDisplayId)
    ? parsed.nextDisplayId
    : maxDisplayId + 1
  const nextDisplayId = Math.max(parsedNextDisplayId, maxDisplayId + 1)
  if (!isValidDisplayId(parsed.nextDisplayId) || nextDisplayId !== parsed.nextDisplayId) {
    migrated = true
  }

  reconcileBranchQueue(finalizedTasks)

  return {
    index: {
      version: 3,
      nextDisplayId,
      tasks: finalizedTasks,
    },
    migrated,
  }
}

function isTaskActive(task: PortTask): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status)
}

export function isTerminalTaskStatus(status: PortTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status)
}

function reconcileBranchQueue(tasks: PortTask[]): void {
  const byLockKey = new Map<string, PortTask[]>()

  for (const task of tasks) {
    if (task.mode !== 'write' || !task.branch) {
      continue
    }

    const lockKey = task.queue?.lockKey ?? task.branch
    task.queue = {
      ...(task.queue ?? {}),
      lockKey,
    }

    const grouped = byLockKey.get(lockKey) ?? []
    grouped.push(task)
    byLockKey.set(lockKey, grouped)
  }

  for (const groupedTasks of byLockKey.values()) {
    groupedTasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    let previousActiveId: string | undefined

    for (const task of groupedTasks) {
      if (!isTaskActive(task)) {
        if (task.queue) {
          task.queue.blockedByTaskId = undefined
        }
        continue
      }

      if (!previousActiveId) {
        if (task.queue) {
          task.queue.blockedByTaskId = undefined
        }
      } else if (task.queue) {
        task.queue.blockedByTaskId = previousActiveId
      }

      previousActiveId = task.id
    }
  }
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
  const { index } = await readTaskIndexWithMeta(repoRoot)
  return index
}

async function readTaskIndexWithMeta(repoRoot: string): Promise<ReadTaskIndexResult> {
  const indexPath = getTaskIndexPath(repoRoot)

  if (!existsSync(indexPath)) {
    return {
      index: {
        version: 3,
        nextDisplayId: 1,
        tasks: [],
      },
      migrated: false,
    }
  }

  try {
    const content = await readFile(indexPath, 'utf-8')
    const parsed = JSON.parse(content) as unknown
    return normalizeTaskIndex(parsed)
  } catch {
    return {
      index: {
        version: 3,
        nextDisplayId: 1,
        tasks: [],
      },
      migrated: false,
    }
  }
}

async function writeTaskIndex(repoRoot: string, index: TaskIndex): Promise<void> {
  const indexPath = getTaskIndexPath(repoRoot)
  await writeFileAtomic(indexPath, `${JSON.stringify(index, null, 2)}\n`)
}

async function appendTaskEvent(repoRoot: string, event: PortTaskEvent): Promise<void> {
  const eventPath = getTaskEventPath(repoRoot, event.taskId)
  await appendFile(eventPath, `${JSON.stringify(event)}\n`)
  await appendGlobalTaskEvent(repoRoot, event)
}

export async function ensureTaskStorage(repoRoot: string): Promise<void> {
  await mkdir(getJobsDir(repoRoot), { recursive: true })
  await mkdir(getEventsDir(repoRoot), { recursive: true })
  await mkdir(getTaskRuntimeDir(repoRoot), { recursive: true })
}

export async function createTask(
  repoRoot: string,
  input: { title: string; mode?: PortTaskMode; branch?: string; worker?: string }
): Promise<PortTask> {
  await ensureTaskStorage(repoRoot)
  const lockPath = getTaskIndexLockPath(repoRoot)

  return withFileLock(lockPath, async () => {
    const { index } = await readTaskIndexWithMeta(repoRoot)
    const timestamp = nowIso()
    const task: PortTask = {
      id: `task-${randomUUID().slice(0, 8)}`,
      displayId: index.nextDisplayId,
      title: input.title,
      mode: input.mode ?? 'write',
      status: 'queued',
      branch: input.branch,
      worker: input.worker,
      adapter: 'local',
      capabilities: {
        supportsCheckpoint: false,
        supportsRestore: false,
        supportsAttachHandoff: false,
        supportsResumeToken: false,
        supportsTranscript: false,
        supportsFailedSnapshot: false,
      },
      queue:
        (input.mode ?? 'write') === 'write' && input.branch
          ? {
              lockKey: input.branch,
            }
          : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    index.tasks.push(task)
    index.nextDisplayId += 1
    reconcileBranchQueue(index.tasks)
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
  const lockPath = getTaskIndexLockPath(repoRoot)

  return withFileLock(lockPath, async () => {
    const { index, migrated } = await readTaskIndexWithMeta(repoRoot)
    if (migrated) {
      await writeTaskIndex(repoRoot, index)
    }
    return [...index.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
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
    const { index, migrated } = await readTaskIndexWithMeta(repoRoot)
    const task = index.tasks.find(item => item.id === taskId)

    if (!task) {
      if (migrated) {
        await writeTaskIndex(repoRoot, index)
      }
      return null
    }

    task.status = status
    task.updatedAt = nowIso()
    reconcileBranchQueue(index.tasks)

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

export async function patchTask(
  repoRoot: string,
  taskId: string,
  patch: Partial<PortTask>,
  event?: { type: string; message?: string }
): Promise<PortTask | null> {
  await ensureTaskStorage(repoRoot)
  const lockPath = getTaskIndexLockPath(repoRoot)

  return withFileLock(lockPath, async () => {
    const { index, migrated } = await readTaskIndexWithMeta(repoRoot)
    const task = index.tasks.find(item => item.id === taskId)

    if (!task) {
      if (migrated) {
        await writeTaskIndex(repoRoot, index)
      }
      return null
    }

    Object.assign(task, patch)
    task.updatedAt = nowIso()
    reconcileBranchQueue(index.tasks)

    await writeTaskIndex(repoRoot, index)

    if (event) {
      await appendTaskEvent(repoRoot, {
        id: randomUUID(),
        taskId,
        type: event.type,
        at: task.updatedAt,
        message: event.message,
      })
    }

    return task
  })
}

export async function listRunnableQueuedTasks(repoRoot: string): Promise<PortTask[]> {
  const tasks = await listTasks(repoRoot)
  return tasks
    .filter(task => task.status === 'queued' && !task.queue?.blockedByTaskId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function listRunningTasks(repoRoot: string): Promise<PortTask[]> {
  const tasks = await listTasks(repoRoot)
  return tasks.filter(
    task =>
      task.status === 'preparing' ||
      task.status === 'running' ||
      task.status === 'resuming' ||
      task.status === 'reviving_for_attach'
  )
}

export async function countActiveTasks(repoRoot: string): Promise<number> {
  const tasks = await listTasks(repoRoot)
  return tasks.filter(isTaskActive).length
}

export async function reconcileTaskQueue(repoRoot: string): Promise<void> {
  await ensureTaskStorage(repoRoot)
  const lockPath = getTaskIndexLockPath(repoRoot)

  await withFileLock(lockPath, async () => {
    const { index } = await readTaskIndexWithMeta(repoRoot)
    reconcileBranchQueue(index.tasks)
    await writeTaskIndex(repoRoot, index)
  })
}

export async function readTaskEvents(
  repoRoot: string,
  taskId: string,
  limit: number = 200
): Promise<PortTaskEvent[]> {
  const path = getTaskEventPath(repoRoot, taskId)
  if (!existsSync(path)) {
    return []
  }

  try {
    const raw = await readFile(path, 'utf-8')
    const lines = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    const events: PortTaskEvent[] = []
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as PortTaskEvent)
      } catch {
        // Ignore invalid line entries.
      }
    }

    return events.slice(-limit)
  } catch {
    return []
  }
}

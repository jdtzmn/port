import { appendFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { withFileLock, writeFileAtomic } from './state.ts'
import type { PortTaskEvent } from './taskStore.ts'

interface EventCursor {
  line: number
}

const GLOBAL_EVENTS_FILE = 'all.jsonl'
const SUBSCRIBERS_DIR = 'subscribers'

function getJobsDir(repoRoot: string): string {
  return join(repoRoot, '.port', 'jobs')
}

function getEventsDir(repoRoot: string): string {
  return join(getJobsDir(repoRoot), 'events')
}

function getGlobalEventsPath(repoRoot: string): string {
  return join(getEventsDir(repoRoot), GLOBAL_EVENTS_FILE)
}

function getSubscriberDir(repoRoot: string): string {
  return join(getJobsDir(repoRoot), SUBSCRIBERS_DIR)
}

function getCursorPath(repoRoot: string, consumerId: string): string {
  return join(getSubscriberDir(repoRoot), `${consumerId}.cursor.json`)
}

function getCursorLockPath(repoRoot: string, consumerId: string): string {
  return join(getSubscriberDir(repoRoot), `${consumerId}.cursor.lock`)
}

export function getSubscriberOutboxPath(repoRoot: string, consumerId: string): string {
  return join(getSubscriberDir(repoRoot), `${consumerId}.notifications.log`)
}

export async function ensureTaskEventStorage(repoRoot: string): Promise<void> {
  await mkdir(getEventsDir(repoRoot), { recursive: true })
  await mkdir(getSubscriberDir(repoRoot), { recursive: true })
}

export async function appendGlobalTaskEvent(repoRoot: string, event: PortTaskEvent): Promise<void> {
  await ensureTaskEventStorage(repoRoot)
  await appendFile(getGlobalEventsPath(repoRoot), `${JSON.stringify(event)}\n`)
}

async function readCursor(repoRoot: string, consumerId: string): Promise<EventCursor> {
  const path = getCursorPath(repoRoot, consumerId)
  if (!existsSync(path)) {
    return { line: 0 }
  }

  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as EventCursor
    if (!Number.isInteger(parsed.line) || parsed.line < 0) {
      return { line: 0 }
    }
    return parsed
  } catch {
    return { line: 0 }
  }
}

async function writeCursor(
  repoRoot: string,
  consumerId: string,
  cursor: EventCursor
): Promise<void> {
  await ensureTaskEventStorage(repoRoot)
  await writeFileAtomic(getCursorPath(repoRoot, consumerId), `${JSON.stringify(cursor, null, 2)}\n`)
}

export async function readGlobalTaskEvents(
  repoRoot: string,
  options: { fromLine?: number; limit?: number } = {}
): Promise<{ events: PortTaskEvent[]; nextLine: number }> {
  await ensureTaskEventStorage(repoRoot)
  const path = getGlobalEventsPath(repoRoot)
  if (!existsSync(path)) {
    return { events: [], nextLine: options.fromLine ?? 0 }
  }

  const fromLine = options.fromLine ?? 0
  const limit = options.limit ?? 200
  const raw = await readFile(path, 'utf-8')
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const slice = lines.slice(fromLine, fromLine + limit)
  const events: PortTaskEvent[] = []
  for (const line of slice) {
    try {
      events.push(JSON.parse(line) as PortTaskEvent)
    } catch {
      // ignore invalid lines
    }
  }

  return {
    events,
    nextLine: fromLine + slice.length,
  }
}

export async function consumeGlobalTaskEvents(
  repoRoot: string,
  consumerId: string,
  handler: (event: PortTaskEvent) => Promise<void>,
  options: { limit?: number } = {}
): Promise<number> {
  await ensureTaskEventStorage(repoRoot)
  const lockPath = getCursorLockPath(repoRoot, consumerId)

  return withFileLock(lockPath, async () => {
    const cursor = await readCursor(repoRoot, consumerId)
    const { events, nextLine } = await readGlobalTaskEvents(repoRoot, {
      fromLine: cursor.line,
      limit: options.limit,
    })

    for (const event of events) {
      await handler(event)
    }

    await writeCursor(repoRoot, consumerId, { line: nextLine })
    return events.length
  })
}

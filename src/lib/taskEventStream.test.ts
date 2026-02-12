import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  appendGlobalTaskEvent,
  consumeGlobalTaskEvents,
  readGlobalTaskEvents,
} from './taskEventStream.ts'

const tempDirs = new Set<string>()

function makeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'port-task-events-test-'))
  tempDirs.add(root)
  return root
}

afterEach(async () => {
  await Promise.all(Array.from(tempDirs).map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.clear()
})

describe('taskEventStream', () => {
  test('reads global events sequentially', async () => {
    const repoRoot = makeRepoRoot()
    await appendGlobalTaskEvent(repoRoot, {
      id: 'e1',
      taskId: 'task-1',
      type: 'task.created',
      at: new Date().toISOString(),
      message: 'hello',
    })

    const batch = await readGlobalTaskEvents(repoRoot, { fromLine: 0, limit: 10 })
    expect(batch.events).toHaveLength(1)
    expect(batch.nextLine).toBe(1)
  })

  test('consumer cursor only processes events once', async () => {
    const repoRoot = makeRepoRoot()
    await appendGlobalTaskEvent(repoRoot, {
      id: 'e1',
      taskId: 'task-1',
      type: 'task.created',
      at: new Date().toISOString(),
    })

    const seen: string[] = []
    await consumeGlobalTaskEvents(repoRoot, 'sub-a', async event => {
      seen.push(event.id)
    })
    await consumeGlobalTaskEvents(repoRoot, 'sub-a', async event => {
      seen.push(event.id)
    })

    expect(seen).toEqual(['e1'])
  })
})

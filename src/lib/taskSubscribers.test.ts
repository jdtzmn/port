import { mkdtempSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}))

vi.mock('./config.ts', () => ({
  loadConfig: mocks.loadConfig,
}))

import { appendGlobalTaskEvent, getSubscriberOutboxPath } from './taskEventStream.ts'
import { dispatchConfiguredTaskSubscribers } from './taskSubscribers.ts'

const tempDirs = new Set<string>()

function makeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'port-task-subs-test-'))
  tempDirs.add(root)
  return root
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await Promise.all(Array.from(tempDirs).map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.clear()
})

describe('taskSubscribers', () => {
  test('dispatches opencode notifications when subscriptions are enabled', async () => {
    const repoRoot = makeRepoRoot()
    mocks.loadConfig.mockResolvedValue({
      task: { subscriptions: { enabled: true, consumers: ['opencode'] } },
    })

    await appendGlobalTaskEvent(repoRoot, {
      id: 'ev-1',
      taskId: 'task-1',
      type: 'task.completed',
      at: new Date().toISOString(),
      message: 'done',
    })

    await dispatchConfiguredTaskSubscribers(repoRoot)

    const outbox = await readFile(getSubscriberOutboxPath(repoRoot, 'opencode'), 'utf-8')
    expect(outbox).toContain('<task-notification')
    expect(outbox).toContain('task.completed')
  })
})

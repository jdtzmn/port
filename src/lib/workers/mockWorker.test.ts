import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}))

vi.mock('../exec.ts', () => ({
  execFileAsync: mocks.execFileAsync,
}))

import { MockTaskWorker } from './mockWorker.ts'
import type { TaskWorkerContext } from '../taskWorker.ts'
import type { PortTask } from '../taskStore.ts'

function makeContext(overrides?: Partial<PortTask>): TaskWorkerContext {
  return {
    task: {
      id: 'task-1234',
      displayId: 1,
      title: 'test task',
      mode: 'write',
      status: 'running',
      adapter: 'local',
      capabilities: {
        supportsAttachHandoff: false,
        supportsResumeToken: false,
        supportsTranscript: false,
        supportsFailedSnapshot: false,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    } as PortTask,
    repoRoot: '/repo',
    worktreePath: '/repo/.port/trees/port-task-task-1234',
    appendStdout: vi.fn(),
    appendStderr: vi.fn(),
  }
}

describe('MockTaskWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
  })

  test('executes successfully with default sleep', async () => {
    const worker = new MockTaskWorker('test')
    const ctx = makeContext()

    const result = await worker.execute(ctx)

    expect(result.commitRefs).toEqual([])
    expect(mocks.execFileAsync).toHaveBeenCalledWith('git', ['status', '--short'], {
      cwd: '/repo/.port/trees/port-task-task-1234',
    })
  })

  test('uses sleep hint from title', async () => {
    const worker = new MockTaskWorker('test')
    const ctx = makeContext({ title: 'slow task[sleep=50]' })
    const start = Date.now()

    await worker.execute(ctx)

    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  test('config.sleepMs overrides title hint', async () => {
    const worker = new MockTaskWorker('test', { sleepMs: 10 })
    const ctx = makeContext({ title: 'task[sleep=5000]' })
    const start = Date.now()

    await worker.execute(ctx)

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)
  })

  test('fails when title contains [fail] marker', async () => {
    const worker = new MockTaskWorker('test', { sleepMs: 0 })
    const ctx = makeContext({ title: 'will fail[fail]' })

    await expect(worker.execute(ctx)).rejects.toThrow('[fail] marker')
  })

  test('config.shouldFail overrides title markers', async () => {
    const worker = new MockTaskWorker('test', { sleepMs: 0, shouldFail: true })
    const ctx = makeContext({ title: 'no fail marker here' })

    await expect(worker.execute(ctx)).rejects.toThrow('[fail] marker')
  })

  test('does not fail when config.shouldFail is false even with [fail] in title', async () => {
    const worker = new MockTaskWorker('test', { sleepMs: 0, shouldFail: false })
    const ctx = makeContext({ title: 'has [fail] marker' })

    const result = await worker.execute(ctx)
    expect(result.commitRefs).toEqual([])
  })

  test('runs git status for [edit] in write mode', async () => {
    const worker = new MockTaskWorker('test', { sleepMs: 0 })
    const ctx = makeContext({ title: 'edit task[edit]', mode: 'write' })

    await worker.execute(ctx)

    // Two git status calls: one for validation, one for [edit]
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(2)
  })

  test('skips [edit] git status in read mode', async () => {
    const worker = new MockTaskWorker('test', { sleepMs: 0 })
    const ctx = makeContext({ title: 'edit task[edit]', mode: 'read' })

    await worker.execute(ctx)

    // Only the validation git status call
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(1)
  })

  test('reports correct id and type', () => {
    const worker = new MockTaskWorker('my-worker')

    expect(worker.id).toBe('my-worker')
    expect(worker.type).toBe('mock')
  })
})

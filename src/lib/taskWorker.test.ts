import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}))

vi.mock('./config.ts', () => ({
  loadConfig: mocks.loadConfig,
}))

import { createTaskWorker, resolveTaskWorker } from './taskWorker.ts'
import { MockTaskWorker } from './workers/mockWorker.ts'

describe('taskWorker registry', () => {
  test('createTaskWorker creates a MockTaskWorker for type mock', () => {
    const worker = createTaskWorker('test', { type: 'mock', adapter: 'local' })

    expect(worker).toBeInstanceOf(MockTaskWorker)
    expect(worker.id).toBe('test')
    expect(worker.type).toBe('mock')
  })

  test('createTaskWorker passes config to MockTaskWorker', () => {
    const worker = createTaskWorker('slow', {
      type: 'mock',
      adapter: 'local',
      config: { sleepMs: 5000, shouldFail: true },
    })

    expect(worker).toBeInstanceOf(MockTaskWorker)
    expect(worker.id).toBe('slow')
  })

  test('createTaskWorker creates an OpenCodeTaskWorker for type opencode', () => {
    const worker = createTaskWorker('main', { type: 'opencode', adapter: 'local' })

    expect(worker.id).toBe('main')
    expect(worker.type).toBe('opencode')
  })

  test('createTaskWorker passes config to OpenCodeTaskWorker', () => {
    const worker = createTaskWorker('deep', {
      type: 'opencode',
      adapter: 'local',
      config: { model: 'anthropic/claude-opus-4-6' },
    })

    expect(worker.id).toBe('deep')
    expect(worker.type).toBe('opencode')
  })

  test('resolveTaskWorker resolves from config', async () => {
    mocks.loadConfig.mockResolvedValue({
      task: {
        workers: {
          main: { type: 'mock', adapter: 'local' },
          fast: { type: 'mock', adapter: 'local', config: { sleepMs: 100 } },
        },
      },
    })

    const worker = await resolveTaskWorker('/repo', 'main')

    expect(worker).toBeInstanceOf(MockTaskWorker)
    expect(worker.id).toBe('main')
  })

  test('resolveTaskWorker throws for unknown worker name', async () => {
    mocks.loadConfig.mockResolvedValue({
      task: {
        workers: {
          main: { type: 'mock', adapter: 'local' },
        },
      },
    })

    await expect(resolveTaskWorker('/repo', 'nonexistent')).rejects.toThrow(
      'Worker "nonexistent" not found'
    )
  })

  test('resolveTaskWorker throws when no workers configured', async () => {
    mocks.loadConfig.mockResolvedValue({ task: {} })

    await expect(resolveTaskWorker('/repo', 'main')).rejects.toThrow('Worker "main" not found')
  })
})

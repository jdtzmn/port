import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}))

vi.mock('./config.ts', () => ({
  loadConfig: mocks.loadConfig,
}))

import { createTaskAdapter, listTaskAdapters, resolveTaskAdapter } from './taskAdapterRegistry.ts'

describe('taskAdapterRegistry', () => {
  test('lists local and stub-remote adapters', () => {
    const adapters = listTaskAdapters()
    const ids = adapters.map(adapter => adapter.id)
    expect(ids).toContain('local')
    expect(ids).toContain('stub-remote')
  })

  test('resolves configured adapter without fallback', async () => {
    mocks.loadConfig.mockResolvedValue({ remote: { adapter: 'stub-remote' } })
    const resolved = await resolveTaskAdapter('/repo', '/repo/src/index.ts')

    expect(resolved.configuredId).toBe('stub-remote')
    expect(resolved.resolvedId).toBe('stub-remote')
    expect(resolved.fallbackUsed).toBe(false)
  })

  test('falls back to local when adapter is unknown', async () => {
    mocks.loadConfig.mockResolvedValue({ remote: { adapter: 'does-not-exist' } })
    const resolved = await resolveTaskAdapter('/repo', '/repo/src/index.ts')

    expect(resolved.configuredId).toBe('does-not-exist')
    expect(resolved.resolvedId).toBe('local')
    expect(resolved.fallbackUsed).toBe(true)
  })

  test('can instantiate local adapter directly', () => {
    const adapter = createTaskAdapter('local', '/repo/src/index.ts')
    expect(adapter.id).toBe('local')
  })

  test('adapter contract exposes attach handoff methods across local and stub adapters', async () => {
    const local = createTaskAdapter('local', '/repo/src/index.ts')
    const stub = createTaskAdapter('stub-remote', '/repo/src/index.ts')

    const handle = {
      taskId: 'task-1',
      runId: 'run-1',
      workerPid: 123,
      worktreePath: '/repo/.port/trees/port-task-task-1',
      branch: 'port-task-task-1',
    }

    expect(typeof local.requestHandoff).toBe('function')
    expect(typeof local.attachContext).toBe('function')
    expect(typeof local.resumeFromAttach).toBe('function')
    await expect(local.requestHandoff(handle)).rejects.toThrow('attach handoff')

    expect(typeof stub.requestHandoff).toBe('function')
    expect(typeof stub.attachContext).toBe('function')
    expect(typeof stub.resumeFromAttach).toBe('function')
    await expect(stub.requestHandoff(handle)).rejects.toThrow('attach handoff')
  })
})

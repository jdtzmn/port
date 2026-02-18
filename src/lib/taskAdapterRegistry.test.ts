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

  test('local adapter implements attach handoff methods and stub-remote rejects them', async () => {
    const local = createTaskAdapter('local', '/repo/src/index.ts')
    const stub = createTaskAdapter('stub-remote', '/repo/src/index.ts')

    const handle = {
      taskId: 'task-1',
      runId: 'run-1',
      workerPid: 123,
      worktreePath: '/repo/.port/trees/port-task-task-1',
      branch: 'port-task-task-1',
    }

    // Local adapter is attach-capable and returns valid results
    expect(local.capabilities.supportsAttachHandoff).toBe(true)
    const handoff = await local.requestHandoff(handle)
    expect(handoff.boundary).toBe('immediate')
    expect(handoff.sessionHandle).toBe('run-1')

    const context = await local.attachContext(handle)
    expect(context.sessionHandle).toBe('run-1')
    expect(context.restoreStrategy).toBe('fallback_summary')

    await expect(local.resumeFromAttach(handle)).resolves.toBeUndefined()

    // Stub-remote still rejects
    expect(stub.capabilities.supportsAttachHandoff).toBe(false)
    await expect(stub.requestHandoff(handle)).rejects.toThrow('attach handoff')
    await expect(stub.attachContext(handle)).rejects.toThrow('attach context')
    await expect(stub.resumeFromAttach(handle)).rejects.toThrow('attach resume')
  })
})

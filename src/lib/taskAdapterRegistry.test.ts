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
})

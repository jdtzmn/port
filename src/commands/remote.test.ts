import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detectWorktree: vi.fn(),
  loadConfig: vi.fn(),
  listTaskAdapters: vi.fn(),
  resolveTaskAdapter: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  loadConfig: mocks.loadConfig,
}))

vi.mock('../lib/taskAdapterRegistry.ts', () => ({
  listTaskAdapters: mocks.listTaskAdapters,
  resolveTaskAdapter: mocks.resolveTaskAdapter,
}))

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  newline: mocks.newline,
  info: mocks.info,
  dim: mocks.dim,
  success: mocks.success,
  warn: mocks.warn,
  error: mocks.error,
}))

import { remoteAdapters, remoteDoctor, remoteStatus } from './remote.ts'

describe('remote commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.loadConfig.mockResolvedValue({ remote: { adapter: 'local' } })
    mocks.listTaskAdapters.mockReturnValue([
      {
        id: 'local',
        kind: 'local',
        description: 'local',
        capabilities: {
          supportsCheckpoint: true,
          supportsRestore: true,
          supportsAttachHandoff: false,
          supportsResumeToken: false,
          supportsTranscript: false,
          supportsFailedSnapshot: false,
        },
      },
      {
        id: 'stub-remote',
        kind: 'remote',
        description: 'stub',
        capabilities: {
          supportsCheckpoint: true,
          supportsRestore: true,
          supportsAttachHandoff: false,
          supportsResumeToken: false,
          supportsTranscript: false,
          supportsFailedSnapshot: false,
        },
      },
    ])
    mocks.resolveTaskAdapter.mockResolvedValue({
      configuredId: 'local',
      resolvedId: 'local',
      fallbackUsed: false,
      adapter: { id: 'local' },
    })
  })

  test('remote adapters lists known adapters', async () => {
    await remoteAdapters()

    expect(mocks.header).toHaveBeenCalledWith('Task adapters:')
    expect(mocks.info).toHaveBeenCalledWith('local (configured)')
  })

  test('remote status reports configured and resolved adapters', async () => {
    await remoteStatus()

    expect(mocks.info).toHaveBeenCalledWith('Configured adapter: local')
    expect(mocks.info).toHaveBeenCalledWith('Resolved adapter: local')
  })

  test('remote doctor warns for stub adapter', async () => {
    mocks.loadConfig.mockResolvedValue({ remote: { adapter: 'stub-remote' } })
    mocks.resolveTaskAdapter.mockResolvedValue({
      configuredId: 'stub-remote',
      resolvedId: 'stub-remote',
      fallbackUsed: false,
      adapter: { id: 'stub-remote' },
    })

    await remoteDoctor()

    expect(mocks.warn).toHaveBeenCalledWith(
      'stub-remote is a contract stub and will not execute task workers yet'
    )
    expect(mocks.success).toHaveBeenCalledWith('Remote configuration looks healthy')
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanupStaleHostServices: vi.fn(),
  getAllHostServices: vi.fn(),
  stopHostService: vi.fn(),
  withProgress: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../lib/hostService.ts', () => ({
  cleanupStaleHostServices: mocks.cleanupStaleHostServices,
  stopHostService: mocks.stopHostService,
}))

vi.mock('../lib/registry.ts', () => ({
  getAllHostServices: mocks.getAllHostServices,
}))

vi.mock('../lib/progress.ts', () => ({
  withProgress: mocks.withProgress,
}))

vi.mock('../lib/output.ts', () => ({
  info: mocks.info,
  success: mocks.success,
  error: mocks.error,
  warn: mocks.warn,
}))

import { kill } from './kill.ts'

describe('kill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cleanupStaleHostServices.mockResolvedValue(undefined)
    mocks.getAllHostServices.mockResolvedValue([{ logicalPort: 3000 }])
    mocks.stopHostService.mockResolvedValue('sigkill')
    mocks.withProgress.mockImplementation(async (_options, work) => work())
  })

  test('reports SIGKILL through a warning completion instead of normal success', async () => {
    await kill()

    const [options] = mocks.withProgress.mock.calls[0] as [
      { failureText: string; isSuccess: (result: string) => boolean },
    ]
    expect(options.failureText).toBe('Force killed host service on port 3000')
    expect(options.isSuccess('sigkill')).toBe(false)
    expect(options.isSuccess('sigterm')).toBe(true)
    expect(mocks.info).toHaveBeenCalledWith('Stopped 1 host service(s) (1 force-killed).')
    expect(mocks.success).not.toHaveBeenCalled()
  })
})

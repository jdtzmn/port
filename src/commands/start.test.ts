import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareSharedStack: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../lib/shared-stack.ts', () => ({
  prepareSharedStack: mocks.prepareSharedStack,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  info: mocks.info,
}))

import { start } from './start.ts'

describe('start command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareSharedStack.mockResolvedValue({ started: true, restarted: false, updated: true })
  })

  test('starts the shared stack only', async () => {
    await start()

    expect(mocks.prepareSharedStack).toHaveBeenCalledWith([])
    expect(mocks.success).toHaveBeenCalledWith('Shared stack started')
  })
})

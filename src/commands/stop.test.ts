import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stopSharedStack: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../lib/shared-stack.ts', () => ({
  stopSharedStack: mocks.stopSharedStack,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
}))

import { stop } from './stop.ts'

describe('stop command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stopSharedStack.mockResolvedValue(undefined)
  })

  test('stops the shared stack only', async () => {
    await stop()

    expect(mocks.stopSharedStack).toHaveBeenCalled()
    expect(mocks.success).toHaveBeenCalledWith('port stopped')
  })
})

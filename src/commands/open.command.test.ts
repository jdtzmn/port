import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
}))

vi.mock('./hook.ts', () => ({
  hook: mocks.hook,
}))

import { open } from './open.ts'

describe('open command', () => {
  test('runs post-up hook through hook command', async () => {
    await open()

    expect(mocks.hook).toHaveBeenCalledWith('post-up', {})
  })
})

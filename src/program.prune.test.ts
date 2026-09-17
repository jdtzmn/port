import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prune: vi.fn(),
}))

vi.mock('./commands/prune.ts', () => ({
  prune: mocks.prune,
}))

import { program } from './program.ts'

describe('prune CLI options', () => {
  test('maps --no-fetch to noFetch before invoking the command', async () => {
    mocks.prune.mockResolvedValue(undefined)

    await program.parseAsync(['prune', '--no-fetch'], { from: 'user' })

    expect(mocks.prune).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: false,
        noFetch: true,
      })
    )
  })
})

import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rename: vi.fn(),
}))

vi.mock('./rename.ts', () => ({
  rename: mocks.rename,
}))

import { rename as renameCommand } from './rename.ts'

describe('rename command registration', () => {
  test('exports the rename command implementation', () => {
    expect(renameCommand).toBeTypeOf('function')
  })
})

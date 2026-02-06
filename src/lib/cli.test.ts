import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('./output.ts', () => ({
  error: mocks.error,
}))

import { CliError, failWithError, handleCliError } from './cli.ts'

describe('cli error helpers', () => {
  let exitMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    exitMock = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    exitMock.mockRestore()
  })

  test('failWithError reports and throws CliError', () => {
    expect(() => failWithError('boom')).toThrowError(CliError)
    expect(mocks.error).toHaveBeenCalledWith('boom')
  })

  test('handleCliError reports unreported CliError and exits with code', () => {
    const err = new CliError('bad', { exitCode: 12, alreadyReported: false })

    handleCliError(err)

    expect(mocks.error).toHaveBeenCalledWith('bad')
    expect(exitMock).toHaveBeenCalledWith(12)
  })
})

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ora: vi.fn(),
  spinner: {
    start: vi.fn(),
    succeed: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('ora', () => ({ default: mocks.ora }))

import { withProgress } from './progress.ts'

describe('withProgress', () => {
  const originalIsTTY = process.stderr.isTTY
  const originalCI = process.env.CI

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ora.mockReturnValue(mocks.spinner)
    delete process.env.CI
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
  })

  afterEach(() => {
    if (originalCI === undefined) delete process.env.CI
    else process.env.CI = originalCI
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  test('shows and completes a spinner on stderr for TTY output', async () => {
    await expect(withProgress({ text: 'Starting', successText: 'Started' }, async () => 'done')).resolves.toBe(
      'done'
    )

    expect(mocks.ora).toHaveBeenCalledWith({
      text: 'Starting',
      stream: process.stderr,
      isEnabled: true,
    })
    expect(mocks.spinner.start).toHaveBeenCalledOnce()
    expect(mocks.spinner.succeed).toHaveBeenCalledWith('Started')
    expect(mocks.spinner.stop).not.toHaveBeenCalled()
  })

  test('disables animation when stderr is not a TTY', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true })

    await withProgress({ text: 'Starting' }, async () => undefined)

    expect(mocks.ora).toHaveBeenCalledWith({
      text: 'Starting',
      stream: process.stderr,
      isEnabled: false,
    })
  })

  test('disables animation in CI', async () => {
    process.env.CI = 'true'

    await withProgress({ text: 'Starting' }, async () => undefined)

    expect(mocks.ora).toHaveBeenCalledWith({
      text: 'Starting',
      stream: process.stderr,
      isEnabled: false,
    })
  })

  test('stops the spinner and preserves the original error', async () => {
    const failure = new Error('unable to start')

    await expect(withProgress({ text: 'Starting' }, async () => Promise.reject(failure))).rejects.toBe(
      failure
    )

    expect(mocks.spinner.start).toHaveBeenCalledOnce()
    expect(mocks.spinner.stop).toHaveBeenCalledOnce()
    expect(mocks.spinner.succeed).not.toHaveBeenCalled()
  })
})

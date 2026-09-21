import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ora: vi.fn(),
  spinner: {
    start: vi.fn(),
    succeed: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('ora', () => ({ default: mocks.ora }))

import { withProgress } from './progress.ts'

describe('withProgress', () => {
  const originalIsTTY = process.stderr.isTTY
  const originalColumns = process.stderr.columns
  const originalCI = process.env.CI

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ora.mockReturnValue(mocks.spinner)
    delete process.env.CI
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(process.stderr, 'columns', { value: 80, configurable: true })
  })

  afterEach(() => {
    if (originalCI === undefined) delete process.env.CI
    else process.env.CI = originalCI
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true })
    Object.defineProperty(process.stderr, 'columns', { value: originalColumns, configurable: true })
  })

  test('shows and completes a spinner on stderr for usable TTY output', async () => {
    await expect(
      withProgress({ text: 'Starting', successText: 'Started' }, async () => 'done')
    ).resolves.toBe('done')

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

  test('disables animation for a zero-width pseudo-TTY', async () => {
    Object.defineProperty(process.stderr, 'columns', { value: 0, configurable: true })

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

  test('uses a warning result for a degraded operation', async () => {
    await withProgress(
      {
        text: 'Fetching',
        failureText: 'Fetch unavailable',
        isSuccess: result => result,
      },
      async () => false
    )

    expect(mocks.spinner.warn).toHaveBeenCalledWith('Fetch unavailable')
    expect(mocks.spinner.succeed).not.toHaveBeenCalled()
  })

  test('stops the spinner and preserves the original error', async () => {
    const failure = new Error('unable to start')

    await expect(
      withProgress({ text: 'Starting' }, async () => Promise.reject(failure))
    ).rejects.toBe(failure)

    expect(mocks.spinner.start).toHaveBeenCalledOnce()
    expect(mocks.spinner.stop).toHaveBeenCalledOnce()
    expect(mocks.spinner.succeed).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  header: vi.fn(),
  newline: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  command: vi.fn(),
}))

vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  newline: mocks.newline,
  info: mocks.info,
  dim: mocks.dim,
  command: mocks.command,
}))

import { onboard } from './onboard.ts'

describe('onboard command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.command.mockImplementation((value: string) => value)
  })

  test('prints onboarding flow with command, how, and why guidance', async () => {
    await onboard()

    expect(mocks.header).toHaveBeenCalledWith('Port onboarding')
    expect(mocks.info).toHaveBeenCalledWith('Recommended flow:')
    expect(mocks.header).toHaveBeenCalledWith('1. port init')
    expect(mocks.header).toHaveBeenCalledWith('3. port shell-hook <bash|zsh|fish>')
    expect(mocks.header).toHaveBeenCalledWith('4. port enter <branch>')
    expect(mocks.header).toHaveBeenCalledWith('9. port exit')
    expect(mocks.header).toHaveBeenCalledWith('10. port remove <branch>')
    expect(mocks.dim).toHaveBeenCalledWith(
      '   How: Use explicit enter, especially when branch names match commands.'
    )
    expect(mocks.dim).toHaveBeenCalledWith(
      '   Why: Stops project services and offers Traefik shutdown when appropriate.'
    )
    expect(mocks.info).toHaveBeenCalledWith('Useful checks:')
  })
})

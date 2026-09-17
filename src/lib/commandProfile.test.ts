import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CommandProfileRecorder,
  finishCommandProfile,
  measureCommandPhase,
  profileCommand,
  startCommandProfile,
} from './commandProfile.ts'

afterEach(() => {
  finishCommandProfile()
  vi.unstubAllEnvs()
})

describe('CommandProfileRecorder', () => {
  test('records phase and total durations with a supplied clock', async () => {
    const times = [0, 10, 35, 40]
    const recorder = new CommandProfileRecorder('status', () => times.shift() ?? 0)

    await recorder.measure('docker.worktrees', async () => undefined)

    expect(recorder.finish()).toEqual({
      command: 'status',
      durationMs: 40,
      spans: [{ name: 'docker.worktrees', durationMs: 25 }],
    })
  })

  test('records a phase when its operation fails', async () => {
    const times = [0, 10, 20, 25]
    const recorder = new CommandProfileRecorder('status', () => times.shift() ?? 0)

    await expect(
      recorder.measure('docker.worktrees', async () => {
        throw new Error('docker unavailable')
      })
    ).rejects.toThrow('docker unavailable')

    expect(recorder.finish()).toEqual({
      command: 'status',
      durationMs: 25,
      spans: [{ name: 'docker.worktrees', durationMs: 10 }],
    })
  })

  test('records nested spans individually in completion order', async () => {
    const times = [0, 10, 20, 30, 40, 50]
    const recorder = new CommandProfileRecorder('status', () => times.shift() ?? 0)

    await recorder.measure('outer', () => recorder.measure('inner', async () => undefined))

    expect(recorder.finish()).toEqual({
      command: 'status',
      durationMs: 50,
      spans: [
        { name: 'inner', durationMs: 10 },
        { name: 'outer', durationMs: 30 },
      ],
    })
  })
})

describe('command profile lifecycle', () => {
  test('writes a single machine-readable profile when enabled', async () => {
    vi.stubEnv('PORT_PROFILE', '1')
    const lines: string[] = []

    startCommandProfile(['status'])
    await measureCommandPhase('status.worktrees', async () => undefined)
    finishCommandProfile(line => lines.push(line))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[port-profile\] /)
    expect(JSON.parse(lines[0]!.replace(/^\[port-profile\] /, ''))).toMatchObject({
      command: 'status',
      durationMs: expect.any(Number),
      spans: [{ name: 'status.worktrees', durationMs: expect.any(Number) }],
    })
  })
  test('records only the command name, not its arguments', async () => {
    vi.stubEnv('PORT_PROFILE', '1')
    const lines: string[] = []

    await profileCommand(
      ['run', '3000', '--token', 'topsecret'],
      async () => undefined,
      line => lines.push(line)
    )

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('topsecret')
    expect(lines[0]).not.toContain('--token')
    expect(JSON.parse(lines[0]!.replace(/^\[port-profile\] /, ''))).toMatchObject({
      command: 'run',
    })
  })

  test('finishes the profile when the command fails', async () => {
    vi.stubEnv('PORT_PROFILE', '1')
    const lines: string[] = []

    await expect(
      profileCommand(
        ['status'],
        async () => {
          throw new Error('docker unavailable')
        },
        line => lines.push(line)
      )
    ).rejects.toThrow('docker unavailable')

    expect(lines).toHaveLength(1)
  })

  test('does not write a profile unless enabled', async () => {
    const lines: string[] = []

    startCommandProfile(['status'])
    await measureCommandPhase('status.worktrees', async () => undefined)
    finishCommandProfile(line => lines.push(line))

    expect(lines).toEqual([])
  })
})

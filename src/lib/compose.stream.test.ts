import { beforeEach, describe, expect, test, vi } from 'vitest'

const { execStreamingMock, execWithStdioMock, execAsyncMock } = vi.hoisted(() => ({
  execStreamingMock: vi.fn(),
  execWithStdioMock: vi.fn(),
  execAsyncMock: vi.fn(),
}))

vi.mock('./exec.ts', () => ({
  execAsync: execAsyncMock,
  execStreaming: execStreamingMock,
  execWithStdio: execWithStdioMock,
}))

import { runCompose } from './compose.ts'

describe('runCompose stream mode', () => {
  beforeEach(() => {
    execStreamingMock.mockReset()
    execWithStdioMock.mockReset()
    execAsyncMock.mockReset()
  })

  test('routes stdio=stream through execStreaming and forwards hooks', async () => {
    const onStdoutLine = vi.fn()
    const onStderrLine = vi.fn()
    const controller = new AbortController()

    execStreamingMock.mockResolvedValue({ exitCode: 0 })

    const result = await runCompose(
      '/repo/.port/trees/feature-a',
      'docker-compose.yml',
      'repo-feature-a',
      ['up', '-d'],
      { repoRoot: '/repo', branch: 'feature-a', domain: 'port' },
      {
        stdio: 'stream',
        signal: controller.signal,
        onStdoutLine,
        onStderrLine,
      }
    )

    expect(result).toEqual({ exitCode: 0 })
    expect(execStreamingMock).toHaveBeenCalledTimes(1)

    const [command, options] = execStreamingMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(command).toContain('docker compose')
    expect(options.cwd).toBe('/repo/.port/trees/feature-a')
    expect(options.signal).toBe(controller.signal)
    expect(options.onStdoutLine).toBe(onStdoutLine)
    expect(options.onStderrLine).toBe(onStderrLine)
    expect(execWithStdioMock).not.toHaveBeenCalled()
    expect(execAsyncMock).toHaveBeenCalledTimes(1)
    expect(execAsyncMock).toHaveBeenCalledWith('docker compose version')
  })

  test('does not call execStreaming in capture mode', async () => {
    execAsyncMock.mockResolvedValue({ stdout: 'ok', stderr: '' })

    const result = await runCompose(
      '/repo/.port/trees/feature-a',
      'docker-compose.yml',
      'repo-feature-a',
      ['down'],
      { repoRoot: '/repo', branch: 'feature-a', domain: 'port' },
      {
        stdio: 'capture',
      }
    )

    expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
    expect(execStreamingMock).not.toHaveBeenCalled()
    expect(execAsyncMock).toHaveBeenCalledTimes(2)
  })
})

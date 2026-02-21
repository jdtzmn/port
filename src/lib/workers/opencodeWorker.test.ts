import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}))

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}))

vi.mock('../exec.ts', () => ({
  execFileAsync: mocks.execFileAsync,
}))

import { OpenCodeTaskWorker } from './opencodeWorker.ts'
import type { TaskWorkerContext } from '../taskWorker.ts'
import type { PortTask } from '../taskStore.ts'

function makeContext(overrides?: Partial<PortTask>): TaskWorkerContext {
  return {
    task: {
      id: 'task-1234',
      displayId: 1,
      title: 'Fix the login bug',
      mode: 'write',
      status: 'running',
      adapter: 'local',
      capabilities: {
        supportsAttachHandoff: false,
        supportsResumeToken: false,
        supportsTranscript: false,
        supportsFailedSnapshot: false,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    } as PortTask,
    repoRoot: '/repo',
    worktreePath: '/repo/.port/trees/port-task-task-1234',
    appendStdout: vi.fn(),
    appendStderr: vi.fn(),
  }
}

/**
 * Create a mock child process that emits the given stdout lines and exits.
 */
function mockChildProcess(stdoutLines: string[], exitCode = 0, stderrLines: string[] = []) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable
    stderr: Readable
    pid: number
  }
  child.stdout = new Readable({ read() {} })
  child.stderr = new Readable({ read() {} })
  child.pid = 12345

  // Schedule events on next tick so the caller can attach listeners
  process.nextTick(() => {
    for (const line of stdoutLines) {
      child.stdout.push(line + '\n')
    }
    child.stdout.push(null)

    for (const line of stderrLines) {
      child.stderr.push(line + '\n')
    }
    child.stderr.push(null)

    child.emit('close', exitCode)
  })

  return child
}

describe('OpenCodeTaskWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
  })

  test('reports correct id and type', () => {
    const worker = new OpenCodeTaskWorker('main')
    expect(worker.id).toBe('main')
    expect(worker.type).toBe('opencode')
  })

  test('parses session ID from NDJSON output', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess([
        '{"type":"step_start","sessionID":"ses_abc123","timestamp":1}',
        '{"type":"text","sessionID":"ses_abc123","part":{"text":"hello"}}',
        '{"type":"step_finish","sessionID":"ses_abc123","part":{"reason":"stop"}}',
      ])
    )

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()
    const result = await worker.execute(ctx)

    expect(result.opencode?.sessionId).toBe('ses_abc123')
    expect(ctx.appendStdout).toHaveBeenCalledWith('hello')
  })

  test('collects commit refs from worktree', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess(['{"type":"step_finish","sessionID":"ses_abc","part":{"reason":"stop"}}'])
    )
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'abc123\ndef456\n',
      stderr: '',
    })

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()
    const result = await worker.execute(ctx)

    expect(result.commitRefs).toEqual(['abc123', 'def456'])
  })

  test('throws on non-zero exit code', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess(
        ['{"type":"error","sessionID":"ses_abc","part":{"error":"something broke"}}'],
        1
      )
    )

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()

    await expect(worker.execute(ctx)).rejects.toThrow('opencode exited with code 1')
    expect(ctx.appendStderr).toHaveBeenCalledWith(
      expect.stringContaining('opencode:error something broke')
    )
  })

  test('passes correct args to spawn', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess(['{"type":"step_finish","sessionID":"ses_abc","part":{"reason":"stop"}}'])
    )

    const worker = new OpenCodeTaskWorker('deep', {
      model: 'anthropic/claude-opus-4-6',
      flags: ['--variant', 'high'],
    })
    const ctx = makeContext()
    await worker.execute(ctx)

    expect(mocks.spawn).toHaveBeenCalledWith(
      'opencode',
      [
        'run',
        '--format',
        'json',
        '--model',
        'anthropic/claude-opus-4-6',
        '--variant',
        'high',
        '--',
        'Fix the login bug',
      ],
      expect.objectContaining({
        cwd: '/repo/.port/trees/port-task-task-1234',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    )
  })

  test('uses custom binary path from config', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess(['{"type":"step_finish","sessionID":"ses_abc","part":{"reason":"stop"}}'])
    )

    const worker = new OpenCodeTaskWorker('custom', { binary: '/opt/opencode/bin/opencode' })
    const ctx = makeContext()
    await worker.execute(ctx)

    expect(mocks.spawn).toHaveBeenCalledWith(
      '/opt/opencode/bin/opencode',
      expect.any(Array),
      expect.any(Object)
    )
  })

  test('returns empty commit refs when git log fails', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess(['{"type":"step_finish","sessionID":"ses_abc","part":{"reason":"stop"}}'])
    )
    mocks.execFileAsync.mockRejectedValue(new Error('not a git repo'))

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()
    const result = await worker.execute(ctx)

    expect(result.commitRefs).toEqual([])
  })

  test('filters iTerm2 escape sequences from output', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess([
        ']1337;SetUserVar=opencode_status=aW5fcHJvZ3Jlc3M=',
        '{"type":"text","sessionID":"ses_abc","part":{"text":"actual output"}}',
        ']1337;SetUserVar=opencode_status=Y29tcGxldGU=',
      ])
    )

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()
    await worker.execute(ctx)

    // Should have the text output but not the iTerm2 sequences
    expect(ctx.appendStdout).toHaveBeenCalledWith('actual output')
  })

  test('returns undefined opencode metadata when no session ID', async () => {
    mocks.spawn.mockReturnValue(mockChildProcess(['{"type":"text","part":{"text":"no session"}}']))

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()
    const result = await worker.execute(ctx)

    expect(result.opencode).toBeUndefined()
  })

  test('logs tool_use events', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess([
        '{"type":"tool_use","sessionID":"ses_abc","part":{"name":"file_edit"}}',
        '{"type":"step_finish","sessionID":"ses_abc","part":{"reason":"stop"}}',
      ])
    )

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()
    await worker.execute(ctx)

    expect(ctx.appendStdout).toHaveBeenCalledWith('opencode:tool file_edit')
  })

  test('streams stderr from child process', async () => {
    mocks.spawn.mockReturnValue(
      mockChildProcess(
        ['{"type":"step_finish","sessionID":"ses_abc","part":{"reason":"stop"}}'],
        0,
        ['some debug output']
      )
    )

    const worker = new OpenCodeTaskWorker('main')
    const ctx = makeContext()
    await worker.execute(ctx)

    expect(ctx.appendStderr).toHaveBeenCalledWith('some debug output')
  })
})

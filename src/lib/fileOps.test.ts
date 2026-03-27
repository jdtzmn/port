import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { batchedFileOps } from './fileOps.ts'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void
type ExecImpl = (command: string, options: unknown, callback: ExecCallback) => void

const originalPlatform = process.platform
const originalStdinIsTTY = process.stdin.isTTY
const originalStdoutIsTTY = process.stdout.isTTY
const originalCI = process.env.CI

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function setTTY(stdinIsTTY: boolean, stdoutIsTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinIsTTY, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: stdoutIsTTY, configurable: true })
}

async function loadFileOpsModule(overrides?: { execImpl?: ExecImpl }) {
  vi.resetModules()

  const execMock = vi.fn((command: string, options: unknown, callback: ExecCallback) => {
    if (overrides?.execImpl) {
      overrides.execImpl(command, options, callback)
      return
    }

    callback(null, 'ok', '')
  })

  vi.doMock('child_process', () => ({
    exec: execMock,
    spawn: vi.fn(),
  }))

  const module = await import('./fileOps.ts')

  return {
    batchedFileOps: module.batchedFileOps,
    execMock,
  }
}

describe('batchedFileOps', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    setPlatform('darwin')
    setTTY(true, true)

    delete process.env.CI
    delete process.env.SSH_CONNECTION
    delete process.env.SSH_CLIENT
    delete process.env.SSH_TTY
  })

  afterEach(() => {
    vi.doUnmock('child_process')
    setPlatform(originalPlatform)
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutIsTTY,
      configurable: true,
    })

    if (originalCI === undefined) {
      delete process.env.CI
    } else {
      process.env.CI = originalCI
    }
  })

  test('non-privileged operations execute immediately', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule({
      execImpl: (command, options, callback) => {
        // Handle both 2 and 3 argument forms
        const cb = typeof options === 'function' ? options : callback
        if (cb) cb(null, 'ok', '')
      },
    })
    const batch = batchedFileOps()

    await batch.write('/tmp/test', 'content')

    expect(execMock).toHaveBeenCalledTimes(1)
    expect(String(execMock.mock.calls[0]?.[0])).toContain('echo "content" > /tmp/test')
  })

  test('privileged operations queue without blocking', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    // These should return promises immediately without blocking
    // Don't await them - they only resolve after flush()
    batch.mkdir('/etc/port', { privileged: true })
    batch.write('/etc/port/config', 'data', { privileged: true })
    batch.delete('/etc/port/old', { privileged: true })

    // No execution should have happened yet
    expect(execMock).not.toHaveBeenCalled()

    // Size should reflect queued operations
    expect(batch.size()).toBe(3)
  })

  test('flush executes all queued privileged operations', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    batch.mkdir('/etc/port', { privileged: true })
    batch.write('/etc/port/config', 'data', { privileged: true })

    expect(batch.size()).toBe(2)

    await batch.flush()

    expect(execMock).toHaveBeenCalledTimes(1)
    const [command] = execMock.mock.calls[0] ?? []

    expect(command).toContain('/usr/bin/osascript')
    expect(command).toContain('mkdir -p /etc/port')
    expect(command).toContain('echo "data" > /etc/port/config')

    // Queue should be empty after flush
    expect(batch.size()).toBe(0)
  })

  test('mixed privileged and non-privileged operations work correctly', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule({
      execImpl: (command, options, callback) => {
        const cb = typeof options === 'function' ? options : callback
        if (cb) cb(null, 'ok', '')
      },
    })
    const batch = batchedFileOps()

    // Non-privileged executes immediately
    await batch.write('/tmp/test', 'content')
    expect(execMock).toHaveBeenCalledTimes(1)

    // Privileged queues (don't await - only resolves after flush)
    batch.mkdir('/etc/port', { privileged: true })
    expect(execMock).toHaveBeenCalledTimes(1) // Still just 1 from the non-privileged op

    // Another non-privileged executes immediately
    await batch.write('/tmp/test2', 'content2')
    expect(execMock).toHaveBeenCalledTimes(2)

    // Flush executes the queued privileged op
    await batch.flush()
    expect(execMock).toHaveBeenCalledTimes(3)
  })

  test('cancel clears queued operations without executing', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    // Capture promises to avoid unhandled rejections
    const p1 = batch.mkdir('/etc/port', { privileged: true })
    const p2 = batch.write('/etc/port/config', 'data', { privileged: true })

    expect(batch.size()).toBe(2)

    batch.cancel()

    // Promises should be rejected
    await expect(p1).rejects.toThrow('batch was cleared')
    await expect(p2).rejects.toThrow('batch was cleared')

    expect(batch.size()).toBe(0)
    expect(execMock).not.toHaveBeenCalled()
  })

  test('removeLines queues correctly with platform-specific sed syntax', async () => {
    setPlatform('darwin')
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    batch.removeLines('/etc/port/config', 'test-line', { privileged: true })

    await batch.flush()

    const [command] = execMock.mock.calls[0] ?? []
    // Command is wrapped in osascript, check for the sed -i '' (macOS) pattern
    expect(String(command)).toContain('sed -i')
    expect(String(command)).toContain('/test-line/d')
    expect(String(command)).toContain('/etc/port/config')
  })

  test('removeLines on Linux uses different sed syntax', async () => {
    setPlatform('linux')
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    batch.removeLines('/etc/port/config', 'test-line', { privileged: true })

    await batch.flush()

    const [command] = execMock.mock.calls[0] ?? []
    // Command is wrapped in sudo, check that it contains sed pattern
    expect(String(command)).toContain('sed -i')
    expect(String(command)).toContain('/test-line/d')
    expect(String(command)).toContain('/etc/port/config')
  })

  test('append queues correctly', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    batch.append('/etc/port/config', 'new-line', { privileged: true })

    await batch.flush()

    const [command] = execMock.mock.calls[0] ?? []
    expect(command).toContain('echo "new-line" >> /etc/port/config')
  })

  test('cancel rejects all queued operations', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    const p1 = batch.write('/etc/port/file1', 'data1', { privileged: true })
    const p2 = batch.mkdir('/etc/port/dir', { privileged: true })
    const p3 = batch.delete('/etc/port/old', { privileged: true })

    expect(batch.size()).toBe(3)

    batch.cancel()

    await expect(p1).rejects.toThrow('batch was cleared')
    await expect(p2).rejects.toThrow('batch was cleared')
    await expect(p3).rejects.toThrow('batch was cleared')

    expect(batch.size()).toBe(0)
    expect(execMock).not.toHaveBeenCalled()
  })

  test('flush failure rejects all queued operations', async () => {
    const { batchedFileOps } = await loadFileOpsModule({
      execImpl: (_command, _options, callback) => {
        callback(new Error('permission denied'), '', '')
      },
    })
    const batch = batchedFileOps()

    const p1 = batch.write('/etc/port/file1', 'data1', { privileged: true })
    const p2 = batch.mkdir('/etc/port/dir', { privileged: true })

    expect(batch.size()).toBe(2)

    await expect(batch.flush()).rejects.toThrow('permission denied')

    await expect(p1).rejects.toThrow('permission denied')
    await expect(p2).rejects.toThrow('permission denied')

    expect(batch.size()).toBe(0)
  })

  test('queued operations can be awaited individually and resolve after flush', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    const p1 = batch.write('/etc/port/file1', 'data1', { privileged: true })
    const p2 = batch.mkdir('/etc/port/dir', { privileged: true })

    // Promises should not be resolved yet
    let p1Resolved = false
    let p2Resolved = false

    void p1.then(() => {
      p1Resolved = true
    })
    void p2.then(() => {
      p2Resolved = true
    })

    // Give microtasks a chance to run
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(p1Resolved).toBe(false)
    expect(p2Resolved).toBe(false)

    // Flush should resolve all promises
    await batch.flush()

    // Promises resolve to void (undefined)
    await expect(p1).resolves.toBeUndefined()
    await expect(p2).resolves.toBeUndefined()

    expect(execMock).toHaveBeenCalledTimes(1)
  })

  test('removeLines with cancel rejects properly', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    const p1 = batch.removeLines('/etc/port/config', 'test-line', { privileged: true })

    batch.cancel()

    await expect(p1).rejects.toThrow('batch was cleared')
    expect(execMock).not.toHaveBeenCalled()
  })

  test('append with cancel rejects properly', async () => {
    const { batchedFileOps, execMock } = await loadFileOpsModule()
    const batch = batchedFileOps()

    const p1 = batch.append('/etc/port/config', 'new-line', { privileged: true })

    batch.cancel()

    await expect(p1).rejects.toThrow('batch was cleared')
    expect(execMock).not.toHaveBeenCalled()
  })
})

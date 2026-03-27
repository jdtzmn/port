import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void
type ExecImpl = (command: string, options: unknown, callback: ExecCallback) => void
type SpawnImpl = (
  command: string,
  args: string[],
  options: unknown
) => {
  on: (event: string, handler: (value?: number | Error) => void) => void
}

const originalPlatform = process.platform
const originalStdinIsTTY = process.stdin.isTTY
const originalStdoutIsTTY = process.stdout.isTTY
const originalCI = process.env.CI
const originalSshConnection = process.env.SSH_CONNECTION
const originalSshClient = process.env.SSH_CLIENT
const originalSshTty = process.env.SSH_TTY

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function setTTY(stdinIsTTY: boolean, stdoutIsTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinIsTTY, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: stdoutIsTTY, configurable: true })
}

function restoreEnvValue(key: keyof NodeJS.ProcessEnv, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

async function loadExecModule(overrides?: { execImpl?: ExecImpl; spawnImpl?: SpawnImpl }) {
  vi.resetModules()

  const execMock = vi.fn((command: string, options: unknown, callback: ExecCallback) => {
    if (overrides?.execImpl) {
      overrides.execImpl(command, options, callback)
      return
    }

    callback(null, 'ok', '')
  })

  const spawnMock = vi.fn((command: string, args: string[], options: unknown) => {
    if (overrides?.spawnImpl) {
      return overrides.spawnImpl(command, args, options)
    }

    return {
      on: () => undefined,
    }
  })

  vi.doMock('child_process', () => ({
    exec: execMock,
    spawn: spawnMock,
  }))

  const module = await import('./exec.ts')

  return {
    execPrivileged: module.execPrivileged,
    execWithStdio: module.execWithStdio,
    queuePrivileged: module.queuePrivileged,
    flushPrivilegedBatch: module.flushPrivilegedBatch,
    clearPrivilegedBatch: module.clearPrivilegedBatch,
    getPrivilegedBatchSize: module.getPrivilegedBatchSize,
    execMock,
    spawnMock,
  }
}

describe('execPrivileged', () => {
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

    restoreEnvValue('CI', originalCI)
    restoreEnvValue('SSH_CONNECTION', originalSshConnection)
    restoreEnvValue('SSH_CLIENT', originalSshClient)
    restoreEnvValue('SSH_TTY', originalSshTty)
  })

  test('uses macOS GUI elevation in interactive sessions', async () => {
    const { execPrivileged, execMock } = await loadExecModule()

    await execPrivileged('echo hello')

    expect(execMock).toHaveBeenCalledTimes(1)
    const [command, options] = execMock.mock.calls[0] ?? []

    expect(command).toContain('/usr/bin/osascript')
    expect(command).toContain('with administrator privileges')
    expect(command).toContain("'echo hello'")
    expect(options).toEqual(expect.objectContaining({ cwd: '/' }))
  })

  test('uses sudo on non-macOS', async () => {
    setPlatform('linux')
    const { execPrivileged, execMock } = await loadExecModule()

    await execPrivileged('echo hello')

    expect(execMock).toHaveBeenCalledWith(
      "sudo sh -c 'echo hello'",
      expect.objectContaining({ cwd: '/' }),
      expect.any(Function)
    )
  })

  test('uses sudo on macOS when stdin is not interactive', async () => {
    setTTY(false, true)
    const { execPrivileged, execMock } = await loadExecModule()

    await execPrivileged('echo hello')

    expect(execMock).toHaveBeenCalledWith(
      "sudo sh -c 'echo hello'",
      expect.objectContaining({ cwd: '/' }),
      expect.any(Function)
    )
  })

  test('uses sudo on macOS when running in CI', async () => {
    process.env.CI = '1'
    const { execPrivileged, execMock } = await loadExecModule()

    await execPrivileged('echo hello')

    expect(execMock).toHaveBeenCalledWith(
      "sudo sh -c 'echo hello'",
      expect.objectContaining({ cwd: '/' }),
      expect.any(Function)
    )
  })

  test('uses sudo on macOS over SSH', async () => {
    process.env.SSH_CONNECTION = '1'
    const { execPrivileged, execMock } = await loadExecModule()

    await execPrivileged('echo hello')

    expect(execMock).toHaveBeenCalledWith(
      "sudo sh -c 'echo hello'",
      expect.objectContaining({ cwd: '/' }),
      expect.any(Function)
    )
  })

  test('falls back to sudo when GUI elevation is unavailable', async () => {
    const { execPrivileged, execMock } = await loadExecModule({
      execImpl: (command, _options, callback) => {
        if (command.startsWith('/usr/bin/osascript')) {
          callback(new Error('No user interaction allowed'), '', '')
          return
        }

        callback(null, 'ok', '')
      },
    })

    await execPrivileged('echo hello')

    expect(execMock).toHaveBeenCalledTimes(2)
    expect(String(execMock.mock.calls[0]?.[0])).toContain('/usr/bin/osascript')
    expect(execMock.mock.calls[1]?.[0]).toBe("sudo sh -c 'echo hello'")
  })

  test('falls back to sudo on getcwd permission errors', async () => {
    const getcwdError = Object.assign(new Error('Command failed'), {
      stderr: 'Operation not permitted - getcwd',
    })

    const { execPrivileged, execMock } = await loadExecModule({
      execImpl: (command, _options, callback) => {
        if (command.startsWith('/usr/bin/osascript')) {
          callback(getcwdError, '', '')
          return
        }

        callback(null, 'ok', '')
      },
    })

    await execPrivileged('echo hello')

    expect(execMock).toHaveBeenCalledTimes(2)
    expect(execMock.mock.calls[1]?.[0]).toBe("sudo sh -c 'echo hello'")
  })

  test('rethrows non-fallback GUI errors', async () => {
    const { execPrivileged, execMock } = await loadExecModule({
      execImpl: (_command, _options, callback) => {
        callback(new Error('authentication failed'), '', '')
      },
    })

    await expect(execPrivileged('echo hello')).rejects.toThrow('authentication failed')
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  test('preserves provided cwd and options', async () => {
    const { execPrivileged, execMock } = await loadExecModule()

    await execPrivileged('echo hello', { cwd: '/tmp', timeout: 42 })

    expect(execMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cwd: '/tmp', timeout: 42 }),
      expect.any(Function)
    )
  })

  test('quotes single quotes safely for sudo shell execution', async () => {
    setPlatform('linux')
    const { execPrivileged, execMock } = await loadExecModule()

    await execPrivileged(`echo "it's fine"`)

    const command = String(execMock.mock.calls[0]?.[0])
    expect(command).toContain(`'"'"'`)
  })
})

describe('execWithStdio', () => {
  afterEach(() => {
    vi.doUnmock('child_process')
  })

  test('spawns with inherited stdio and resolves exit code', async () => {
    const { execWithStdio, spawnMock } = await loadExecModule({
      spawnImpl: (_command, _args, _options) => ({
        on: (event, handler) => {
          if (event === 'close') {
            handler(7)
          }
        },
      }),
    })

    await expect(execWithStdio('docker compose up')).resolves.toEqual({ exitCode: 7 })

    expect(spawnMock).toHaveBeenCalledWith(
      'docker compose up',
      [],
      expect.objectContaining({ stdio: 'inherit', shell: true })
    )
  })

  test('rejects when spawn emits error', async () => {
    const { execWithStdio } = await loadExecModule({
      spawnImpl: (_command, _args, _options) => ({
        on: (event, handler) => {
          if (event === 'error') {
            handler(new Error('spawn failure'))
          }
        },
      }),
    })

    await expect(execWithStdio('docker compose up')).rejects.toThrow('spawn failure')
  })

  test('unrefs stdin after child process closes so the event loop can drain', async () => {
    const unrefSpy = vi.spyOn(process.stdin, 'unref')

    const { execWithStdio } = await loadExecModule({
      spawnImpl: (_command, _args, _options) => ({
        on: (event: string, handler: (code?: number) => void) => {
          if (event === 'close') {
            handler(0)
          }
        },
      }),
    })

    await execWithStdio('docker compose up -d')

    expect(unrefSpy).toHaveBeenCalled()
    unrefSpy.mockRestore()
  })
})

describe('batched privileged execution', () => {
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

    restoreEnvValue('CI', originalCI)
    restoreEnvValue('SSH_CONNECTION', originalSshConnection)
    restoreEnvValue('SSH_CLIENT', originalSshClient)
    restoreEnvValue('SSH_TTY', originalSshTty)
  })

  test('queues commands and combines them into a single osascript call', async () => {
    const { queuePrivileged, flushPrivilegedBatch, execMock } = await loadExecModule()

    const p1 = queuePrivileged('mkdir -p /etc/port')
    const p2 = queuePrivileged('echo "config" > /etc/port/config')
    const p3 = queuePrivileged('chmod 644 /etc/port/config')

    expect(execMock).not.toHaveBeenCalled()

    await flushPrivilegedBatch()

    // Should execute once with all commands combined
    expect(execMock).toHaveBeenCalledTimes(1)
    const [command] = execMock.mock.calls[0] ?? []

    expect(command).toContain('/usr/bin/osascript')
    expect(command).toContain('mkdir -p /etc/port')
    expect(command).toContain('echo "config" > /etc/port/config')
    expect(command).toContain('chmod 644 /etc/port/config')

    // All promises should resolve
    await expect(p1).resolves.toBeDefined()
    await expect(p2).resolves.toBeDefined()
    await expect(p3).resolves.toBeDefined()
  })

  test('single queued command uses direct execution path', async () => {
    const { queuePrivileged, flushPrivilegedBatch, execMock } = await loadExecModule()

    const p1 = queuePrivileged('mkdir -p /etc/port')

    await flushPrivilegedBatch()

    expect(execMock).toHaveBeenCalledTimes(1)
    const [command] = execMock.mock.calls[0] ?? []

    expect(command).toContain('/usr/bin/osascript')
    expect(command).toContain('mkdir -p /etc/port')

    await expect(p1).resolves.toBeDefined()
  })

  test('getPrivilegedBatchSize returns queue size', async () => {
    const { queuePrivileged, getPrivilegedBatchSize, flushPrivilegedBatch } = await loadExecModule()

    expect(getPrivilegedBatchSize()).toBe(0)

    queuePrivileged('cmd1')
    expect(getPrivilegedBatchSize()).toBe(1)

    queuePrivileged('cmd2')
    queuePrivileged('cmd3')
    expect(getPrivilegedBatchSize()).toBe(3)

    await flushPrivilegedBatch()
    expect(getPrivilegedBatchSize()).toBe(0)
  })

  test('clearPrivilegedBatch rejects all queued commands', async () => {
    const { queuePrivileged, clearPrivilegedBatch, execMock } = await loadExecModule()

    const p1 = queuePrivileged('cmd1')
    const p2 = queuePrivileged('cmd2')

    clearPrivilegedBatch()

    await expect(p1).rejects.toThrow('batch was cleared')
    await expect(p2).rejects.toThrow('batch was cleared')
    expect(execMock).not.toHaveBeenCalled()
  })

  test('batch execution rejects all promises on failure', async () => {
    const { queuePrivileged, flushPrivilegedBatch, execMock } = await loadExecModule({
      execImpl: (_command, _options, callback) => {
        callback(new Error('permission denied'), '', '')
      },
    })

    const p1 = queuePrivileged('cmd1')
    const p2 = queuePrivileged('cmd2')

    await expect(flushPrivilegedBatch()).rejects.toThrow('permission denied')

    await expect(p1).rejects.toThrow('permission denied')
    await expect(p2).rejects.toThrow('permission denied')
  })

  test('flush with empty batch does nothing', async () => {
    const { flushPrivilegedBatch, execMock } = await loadExecModule()

    await flushPrivilegedBatch()

    expect(execMock).not.toHaveBeenCalled()
  })

  test('batch uses sudo on non-macOS platforms', async () => {
    setPlatform('linux')
    const { queuePrivileged, flushPrivilegedBatch, execMock } = await loadExecModule()

    queuePrivileged('cmd1')
    queuePrivileged('cmd2')

    await flushPrivilegedBatch()

    expect(execMock).toHaveBeenCalledTimes(1)
    const [command] = execMock.mock.calls[0] ?? []

    expect(command).toContain('sudo sh -c')
    expect(command).toContain('cmd1')
    expect(command).toContain('cmd2')
  })

  test('batch falls back to sudo when GUI elevation is unavailable', async () => {
    const { queuePrivileged, flushPrivilegedBatch, execMock } = await loadExecModule({
      execImpl: (command, _options, callback) => {
        if (command.startsWith('/usr/bin/osascript')) {
          callback(new Error('No user interaction allowed'), '', '')
          return
        }

        callback(null, 'ok', '')
      },
    })

    queuePrivileged('cmd1')
    queuePrivileged('cmd2')

    await flushPrivilegedBatch()

    expect(execMock).toHaveBeenCalledTimes(2)
    expect(String(execMock.mock.calls[0]?.[0])).toContain('/usr/bin/osascript')
    expect(execMock.mock.calls[1]?.[0]).toContain('sudo sh -c')
  })
})

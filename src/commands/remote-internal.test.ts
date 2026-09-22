import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRemoteInstanceId: vi.fn(),
  collectRemoteSnapshot: vi.fn(),
  prepareRemoteSession: vi.fn(),
  observeRemoteSession: vi.fn(),
  cleanupRemoteSession: vi.fn(),
  maintainRemoteRuntimeObservation: vi.fn(),
  registerRemoteRuntimeObservation: vi.fn(),
  stopRemoteRuntimeObservation: vi.fn(),
  runRemoteRuntime: vi.fn(),
  runRemoteObservationRuntime: vi.fn(),
  runRemoteSupervisor: vi.fn(),
  remoteHandshake: vi.fn(() => ({ kind: 'port-handshake', version: 1 })),
}))
vi.mock('../lib/remote/session/session.ts', () => mocks)
vi.mock('../lib/remote/session/identity.ts', () => mocks)
vi.mock('../lib/remote/session/snapshotCollector.ts', () => mocks)
vi.mock('../lib/remote/coordinator/supervisor.ts', () => mocks)
vi.mock('../lib/remote/coordinator/runtime.ts', () => mocks)
import { dispatchRemoteInternalCommand, isRemoteInternalCommand } from './remote-internal.ts'

describe('private remote dispatch', () => {
  let stdout: ReturnType<typeof vi.spyOn>
  let stderr: ReturnType<typeof vi.spyOn>
  let previous: typeof process.exitCode
  beforeEach(() => {
    vi.clearAllMocks()
    previous = process.exitCode
    process.exitCode = 0
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    mocks.prepareRemoteSession.mockResolvedValue('/tmp/port-ssh-abc123')
    mocks.stopRemoteRuntimeObservation.mockResolvedValue(true)
    mocks.getRemoteInstanceId.mockResolvedValue('550e8400-e29b-41d4-a716-446655440000')
    mocks.collectRemoteSnapshot.mockImplementation(async (instanceId, revision) => ({
      version: 1,
      kind: 'port-service-snapshot',
      instanceId,
      revision,
      worktrees: [],
    }))
  })
  afterEach(() => {
    stdout.mockRestore()
    stderr.mockRestore()
    process.exitCode = previous
  })

  test('only recognizes the eight exact endpoints', () => {
    for (const suffix of [
      'prepare',
      'register',
      'observe',
      'cleanup',
      'handshake',
      'snapshot',
      'runtime',
      'supervise',
    ]) {
      expect(isRemoteInternalCommand(`__remote-${suffix}`)).toBe(true)
    }
    for (const token of [
      undefined,
      'remote',
      '__remote-handshake-extra',
      '__remote-service-snapshot',
    ]) {
      expect(isRemoteInternalCommand(token)).toBe(false)
    }
  })

  test('runtime dispatch selects full and observation-only modes explicitly', async () => {
    await dispatchRemoteInternalCommand('__remote-runtime', [])
    expect(mocks.runRemoteRuntime).toHaveBeenCalledOnce()
    expect(mocks.runRemoteObservationRuntime).not.toHaveBeenCalled()

    vi.clearAllMocks()
    await dispatchRemoteInternalCommand('__remote-runtime', ['--observe-only'])
    expect(mocks.runRemoteObservationRuntime).toHaveBeenCalledOnce()
    expect(mocks.runRemoteRuntime).not.toHaveBeenCalled()
  })

  test('runtime dispatch rejects every other mode', async () => {
    await dispatchRemoteInternalCommand('__remote-runtime', ['--other'])
    expect(process.exitCode).toBe(1)
    expect(mocks.runRemoteRuntime).not.toHaveBeenCalled()
    expect(mocks.runRemoteObservationRuntime).not.toHaveBeenCalled()
  })

  test('prepare consumes exactly the separator and preserves argv', async () => {
    await dispatchRemoteInternalCommand('__remote-prepare', ['--', '-p', '22', 'a b', '', '$(x)'])
    expect(mocks.prepareRemoteSession).toHaveBeenCalledWith(['-p', '22', 'a b', '', '$(x)'])
    expect(stdout).toHaveBeenCalledExactlyOnceWith('legacy /tmp/port-ssh-abc123\n')
    expect(stderr).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
  })

  test('prepare labels deterministic managed sessions', async () => {
    const directory = `/tmp/port-ssh-${'a'.repeat(40)}`
    mocks.prepareRemoteSession.mockResolvedValueOnce(directory)
    await dispatchRemoteInternalCommand('__remote-prepare', ['--', 'devbox.od'])
    expect(stdout).toHaveBeenCalledExactlyOnceWith(`managed ${directory}\n`)
    expect(process.exitCode).toBe(0)
  })

  test('managed-only prepare preserves noninteractive argv without legacy state', async () => {
    const directory = `/tmp/port-ssh-${'b'.repeat(40)}`
    mocks.prepareRemoteSession.mockResolvedValueOnce(directory)
    await dispatchRemoteInternalCommand('__remote-prepare', [
      '--managed-only',
      '--',
      'devbox.od',
      'command',
    ])
    expect(mocks.prepareRemoteSession).toHaveBeenCalledExactlyOnceWith(
      ['devbox.od', 'command'],
      true
    )
    expect(stdout).toHaveBeenCalledExactlyOnceWith(`managed ${directory}\n`)
  })

  test('register admits one exact lowercase OpenSSH connection id without output', async () => {
    const id = 'abcdef0123456789'.repeat(3)
    mocks.registerRemoteRuntimeObservation.mockResolvedValueOnce(false)
    await dispatchRemoteInternalCommand('__remote-register', [id])
    expect(mocks.registerRemoteRuntimeObservation).toHaveBeenCalledExactlyOnceWith(
      `/tmp/port-ssh-${id}`
    )
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
  })

  test.each([
    { args: [] },
    { args: ['a'.repeat(39)] },
    { args: ['a'.repeat(65)] },
    { args: ['A'.repeat(40)] },
    { args: ['a'.repeat(40), 'extra'] },
  ])('register rejects malformed argv $args', async ({ args }) => {
    await dispatchRemoteInternalCommand('__remote-register', args)
    expect(mocks.registerRemoteRuntimeObservation).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  test('handshake is only fixed protocol JSON', async () => {
    await dispatchRemoteInternalCommand('__remote-handshake', [])
    expect(stdout).toHaveBeenCalledExactlyOnceWith('{"kind":"port-handshake","version":1}\n')
    expect(mocks.prepareRemoteSession).not.toHaveBeenCalled()
    expect(mocks.getRemoteInstanceId).not.toHaveBeenCalled()
    expect(mocks.collectRemoteSnapshot).not.toHaveBeenCalled()
  })

  test.each(['0', '42', String(Number.MAX_SAFE_INTEGER)])(
    'snapshot revision %s emits one validated JSON line',
    async revision => {
      await dispatchRemoteInternalCommand('__remote-snapshot', [revision])
      expect(mocks.getRemoteInstanceId).toHaveBeenCalledTimes(1)
      expect(mocks.collectRemoteSnapshot).toHaveBeenCalledExactlyOnceWith(
        '550e8400-e29b-41d4-a716-446655440000',
        Number(revision)
      )
      expect(stdout).toHaveBeenCalledTimes(1)
      const line = stdout.mock.calls[0]![0] as string
      expect(line.split('\n')).toHaveLength(2)
      expect(Buffer.byteLength(line)).toBeLessThan(4 * 1024 * 1024)
      expect(JSON.parse(line)).toEqual({
        version: 1,
        kind: 'port-service-snapshot',
        instanceId: '550e8400-e29b-41d4-a716-446655440000',
        revision: Number(revision),
        worktrees: [],
      })
      expect(stderr).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(0)
    }
  )

  test.each([
    [],
    ['0', '1'],
    [''],
    ['-1'],
    ['-0'],
    ['01'],
    ['+1'],
    ['1.0'],
    ['1e2'],
    [' 1'],
    ['1\n'],
    ['NaN'],
    ['9007199254740992'],
  ])('rejects snapshot arguments %j before IO', async (...args) => {
    await dispatchRemoteInternalCommand('__remote-snapshot', args)
    expect(mocks.getRemoteInstanceId).not.toHaveBeenCalled()
    expect(mocks.collectRemoteSnapshot).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  test.each(['identity', 'collector', 'malformed', 'oversized'])(
    'snapshot %s failure is silent',
    async failure => {
      if (failure === 'identity')
        mocks.getRemoteInstanceId.mockRejectedValueOnce(new Error('private path'))
      if (failure === 'collector')
        mocks.collectRemoteSnapshot.mockRejectedValueOnce(new Error('private Docker error'))
      if (failure === 'malformed')
        mocks.collectRemoteSnapshot.mockResolvedValueOnce({ private: 'invalid' })
      if (failure === 'oversized')
        mocks.collectRemoteSnapshot.mockResolvedValueOnce({ private: 'x'.repeat(4 * 1024 * 1024) })
      await dispatchRemoteInternalCommand('__remote-snapshot', ['0'])
      expect(stdout).not.toHaveBeenCalled()
      expect(stderr).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
      if (failure === 'identity') expect(mocks.collectRemoteSnapshot).not.toHaveBeenCalled()
    }
  )

  test('observe delegates only admission maintenance and has no output', async () => {
    await dispatchRemoteInternalCommand('__remote-observe', ['/tmp/port-ssh-abc123'])
    expect(mocks.maintainRemoteRuntimeObservation).toHaveBeenCalledWith(
      '/tmp/port-ssh-abc123',
      expect.any(AbortSignal)
    )
    expect(mocks.observeRemoteSession).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })

  test('cleanup stops coordinator observation before touching the private master', async () => {
    await dispatchRemoteInternalCommand('__remote-cleanup', ['/tmp/port-ssh-abc123'])
    expect(mocks.stopRemoteRuntimeObservation).toHaveBeenCalledExactlyOnceWith(
      '/tmp/port-ssh-abc123'
    )
    expect(mocks.cleanupRemoteSession).toHaveBeenCalledExactlyOnceWith('/tmp/port-ssh-abc123')
    expect(mocks.stopRemoteRuntimeObservation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cleanupRemoteSession.mock.invocationCallOrder[0]!
    )
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })

  test('cleanup retains the master when observation cancellation is ambiguous', async () => {
    mocks.stopRemoteRuntimeObservation.mockResolvedValueOnce(false)
    await dispatchRemoteInternalCommand('__remote-cleanup', ['/tmp/port-ssh-abc123'])
    expect(process.exitCode).toBe(1)
    expect(mocks.cleanupRemoteSession).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })

  test.each([
    ['__remote-handshake', ['extra']],
    ['__remote-prepare', []],
    ['__remote-prepare', ['--']],
    ['__remote-prepare', ['host']],
    ['__remote-observe', []],
    ['__remote-cleanup', ['/tmp/port-ssh-abc123', 'extra']],
    ['__remote-cleanup', ['/tmp/port-ssh-abc123/../bad']],
    ['__remote-observe', ['/tmp/port-ssh-abc123\n']],
    ['unknown', []],
  ] satisfies [string, string[]][])('rejects malformed %s %j silently', async (token, args) => {
    await dispatchRemoteInternalCommand(token, args)
    expect(process.exitCode).toBe(1)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    expect(mocks.prepareRemoteSession).not.toHaveBeenCalled()
    expect(mocks.observeRemoteSession).not.toHaveBeenCalled()
    expect(mocks.maintainRemoteRuntimeObservation).not.toHaveBeenCalled()
    expect(mocks.stopRemoteRuntimeObservation).not.toHaveBeenCalled()
    expect(mocks.cleanupRemoteSession).not.toHaveBeenCalled()
  })

  test.each([null, '', '/bad', '/tmp/port-ssh-abc123\n'])(
    'rejects unavailable or malformed prepare result %j',
    async value => {
      mocks.prepareRemoteSession.mockResolvedValueOnce(value)
      await dispatchRemoteInternalCommand('__remote-prepare', ['--', 'host'])
      expect(process.exitCode).toBe(1)
      expect(stdout).not.toHaveBeenCalled()
    }
  )

  test('swallows library exceptions', async () => {
    mocks.prepareRemoteSession.mockRejectedValueOnce(new Error('private'))
    await dispatchRemoteInternalCommand('__remote-prepare', ['--', 'host'])
    expect(process.exitCode).toBe(1)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })
})

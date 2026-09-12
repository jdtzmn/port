import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRemoteInstanceId: vi.fn(),
  collectRemoteSnapshot: vi.fn(),
  prepareRemoteSession: vi.fn(),
  observeRemoteSession: vi.fn(),
  cleanupRemoteSession: vi.fn(),
  remoteHandshake: vi.fn(() => ({ kind: 'port-handshake', version: 1 })),
}))
vi.mock('../lib/remote/session/session.ts', () => mocks)
vi.mock('../lib/remote/session/identity.ts', () => mocks)
vi.mock('../lib/remote/session/snapshotCollector.ts', () => mocks)
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

  test('only recognizes the five exact endpoints', () => {
    for (const suffix of ['prepare', 'observe', 'cleanup', 'handshake', 'snapshot']) {
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

  test('prepare consumes exactly the separator and preserves argv', async () => {
    await dispatchRemoteInternalCommand('__remote-prepare', ['--', '-p', '22', 'a b', '', '$(x)'])
    expect(mocks.prepareRemoteSession).toHaveBeenCalledWith(['-p', '22', 'a b', '', '$(x)'])
    expect(stdout).toHaveBeenCalledExactlyOnceWith('/tmp/port-ssh-abc123\n')
    expect(stderr).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
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

  test.each(['__remote-observe', '__remote-cleanup'])('%s has no output', async token => {
    await dispatchRemoteInternalCommand(token, ['/tmp/port-ssh-abc123'])
    const handler =
      token === '__remote-observe' ? mocks.observeRemoteSession : mocks.cleanupRemoteSession
    expect(handler).toHaveBeenCalledWith(
      '/tmp/port-ssh-abc123',
      ...(token === '__remote-observe' ? [undefined, expect.any(Function)] : [])
    )
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

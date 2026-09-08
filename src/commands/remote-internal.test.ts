import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareRemoteSession: vi.fn(),
  observeRemoteSession: vi.fn(),
  cleanupRemoteSession: vi.fn(),
  remoteHandshake: vi.fn(() => ({ kind: 'port-handshake', version: 1 })),
}))
vi.mock('../lib/remoteSession.ts', () => mocks)
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
  })
  afterEach(() => {
    stdout.mockRestore()
    stderr.mockRestore()
    process.exitCode = previous
  })

  test('only recognizes the four exact endpoints', () => {
    for (const suffix of ['prepare', 'observe', 'cleanup', 'handshake']) {
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
  })

  test.each(['__remote-observe', '__remote-cleanup'])('%s has no output', async token => {
    await dispatchRemoteInternalCommand(token, ['/tmp/port-ssh-abc123'])
    const handler =
      token === '__remote-observe' ? mocks.observeRemoteSession : mocks.cleanupRemoteSession
    expect(handler).toHaveBeenCalledWith('/tmp/port-ssh-abc123')
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  platform: vi.fn(),
  ensure: vi.fn(),
  configured: vi.fn(),
  bound: vi.fn(),
  running: vi.fn(),
  start: vi.fn(),
  restart: vi.fn(),
}))
vi.mock('node:child_process', () => ({ execFile: mocks.exec }))
vi.mock('node:os', () => ({ platform: mocks.platform }))
vi.mock('./traefik.ts', () => ({
  TRAEFIK_NETWORK: 'traefik-network',
  ensureTraefikPorts: mocks.ensure,
  getConfiguredPorts: mocks.configured,
}))
vi.mock('./compose.ts', () => ({
  getTraefikBoundPorts: mocks.bound,
  isTraefikRunning: mocks.running,
  startTraefik: mocks.start,
  restartTraefik: mocks.restart,
}))
import { prepareRemoteProxy } from './remoteProxy.ts'
let state: unknown[]
let network: unknown[]
beforeEach(() => {
  vi.resetAllMocks()
  mocks.platform.mockReturnValue('linux')
  mocks.ensure.mockResolvedValue(false)
  mocks.configured.mockResolvedValue([3000, 5432])
  mocks.bound.mockResolvedValue([80, 3000, 5432])
  mocks.running.mockResolvedValue(true)
  state = [
    'a'.repeat(64),
    true,
    '2025-01-01T00:00:00.123456789Z',
    'running',
    1,
    'b'.repeat(64),
    '172.20.0.2',
    '172.20.0.1',
    ['host.docker.internal:host-gateway'],
  ]
  network = [
    'b'.repeat(64),
    'traefik-network',
    'bridge',
    'local',
    false,
    [{ Subnet: '172.20.0.0/16', Gateway: '172.20.0.1' }],
    '172.20.0.2/16',
  ]
  mocks.exec.mockImplementation((_file, args, _options, callback) =>
    callback(null, { stdout: JSON.stringify(args[0] === 'network' ? network : state), stderr: '' })
  )
})
describe('prepareRemoteProxy (all host operations mocked)', () => {
  it('no-ops, preserves configured ports and binds the exact Linux gateway and peer', async () => {
    const result = await prepareRemoteProxy([3000, 3000])
    expect(mocks.ensure).toHaveBeenCalledWith([3000])
    expect(mocks.restart).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      bind: { kind: 'docker-bridge', address: '172.20.0.1', peerAddress: '172.20.0.2' },
      targetAddress: '172.20.0.1',
    })
    expect(mocks.exec).toHaveBeenCalledTimes(3)
    for (const [file, args, opts] of mocks.exec.mock.calls) {
      expect(file).toBe('docker')
      expect(args).toContain('--format')
      expect(args.join(' ')).not.toMatch(/\.Env|json \.}}|logs/)
      expect(opts).toMatchObject({ timeout: 5000, maxBuffer: 16384 })
    }
  })
  it('treats Docker timestamps as incarnation data, not a synchronized host clock', async () => {
    state[2] = new Date(Date.now() + 86_400_000).toISOString()
    await expect(prepareRemoteProxy([3000])).resolves.toHaveProperty('id')
  })
  it.each(['config', 'bindings'])('restarts only for %s drift', async kind => {
    if (kind === 'config') mocks.ensure.mockResolvedValue(true)
    else mocks.bound.mockResolvedValueOnce([80, 3000])
    await prepareRemoteProxy([3000])
    expect(mocks.restart).toHaveBeenCalledTimes(1)
  })
  it('starts a missing proxy', async () => {
    mocks.running.mockResolvedValue(false)
    await prepareRemoteProxy([])
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.restart).not.toHaveBeenCalled()
  })
  it('uses only the exact Docker hostname on macOS', async () => {
    mocks.platform.mockReturnValue('darwin')
    expect(await prepareRemoteProxy([])).toMatchObject({
      bind: { kind: 'loopback' },
      targetAddress: 'host.docker.internal',
    })
    state[8] = []
    await expect(prepareRemoteProxy([])).rejects.toThrow()
  })
  it.each([0, 65536, 1.5, NaN])('rejects invalid port %s before side effects', async port => {
    await expect(prepareRemoteProxy([port])).rejects.toThrow()
    expect(mocks.ensure).not.toHaveBeenCalled()
  })
  it('rejects oversized requests and unsupported platforms', async () => {
    await expect(prepareRemoteProxy(Array(4097).fill(80))).rejects.toThrow()
    mocks.platform.mockReturnValue('win32')
    await expect(prepareRemoteProxy([])).rejects.toThrow()
    expect(mocks.ensure).not.toHaveBeenCalled()
  })
  it.each([
    [1, false],
    [2, 'invalid'],
    [2, '0001-01-01T00:00:00Z'],
    [4, 2],
    [5, 'bad'],
    [6, '8.8.8.8'],
    [7, '0.250.250.254'],
    [7, '127.0.0.1'],
  ])('rejects invalid container field %s=%s', async (index, value) => {
    state[index as number] = value
    await expect(prepareRemoteProxy([])).rejects.toThrow()
  })
  it.each([
    [0, 'c'.repeat(64)],
    [2, 'overlay'],
    [3, 'swarm'],
    [5, []],
    [5, [{ Subnet: '172.20.0.0/16', Gateway: '172.20.0.1' }, {}]],
    [6, '172.20.0.3/16'],
  ])('rejects ambiguous/nonlocal network field %s', async (index, value) => {
    network[index as number] = value
    await expect(prepareRemoteProxy([])).rejects.toThrow()
  })
  it('fails closed on malformed inspect output or execution failure', async () => {
    mocks.exec.mockImplementationOnce((_f, _a, _o, cb) => cb(null, { stdout: '{', stderr: '' }))
    await expect(prepareRemoteProxy([])).rejects.toThrow()
    mocks.exec.mockImplementationOnce((_f, _a, _o, cb) => cb(new Error('docker unavailable')))
    await expect(prepareRemoteProxy([])).rejects.toThrow('Invalid remote proxy state')
  })
  it('never succeeds on failed preparation or persistent binding drift', async () => {
    mocks.bound.mockResolvedValue([80])
    await expect(prepareRemoteProxy([])).rejects.toThrow()
    expect(mocks.exec).not.toHaveBeenCalled()
    mocks.restart.mockRejectedValue(new Error('restart failed'))
    await expect(prepareRemoteProxy([])).rejects.toThrow('restart failed')
  })
  it('fingerprints restart and replacement incarnations', async () => {
    const first = await prepareRemoteProxy([])
    state[2] = '2025-01-02T00:00:00Z'
    const second = await prepareRemoteProxy([])
    expect(second.id).not.toBe(first.id)
    state[0] = 'c'.repeat(64)
    expect((await prepareRemoteProxy([])).id).not.toBe(second.id)
  })
  it('rejects replacement during inspection', async () => {
    mocks.exec.mockImplementationOnce((_f, _a, _o, cb) => {
      const stdout = JSON.stringify(state)
      state[0] = 'c'.repeat(64)
      cb(null, { stdout, stderr: '' })
    })
    await expect(prepareRemoteProxy([])).rejects.toThrow()
  })
})

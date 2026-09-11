import { createConnection, Socket, Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRemoteRouteGuard } from './remoteRouteGuard.ts'
import type { RemoteRoutePlan } from './remoteRoutePlan.ts'

const plan = (): RemoteRoutePlan => ({
  hostname: 'app.feature.port',
  port: 8080,
  transport: 'http',
  resolution: {
    status: 'conflict',
    candidates: [
      { owner: { id: 'b', kind: 'ssh', label: 'Remote' }, worktreeId: 'wt-b', services: [] },
      { owner: { id: 'a', kind: 'local', label: 'Local' }, worktreeId: 'wt-a', services: [] },
    ],
  },
})
type Guard = Awaited<ReturnType<typeof startRemoteRouteGuard>>
const guards: Guard[] = []
const clients: Socket[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const client of clients.splice(0)) client.destroy()
  await Promise.all(guards.splice(0).map(guard => guard.close()))
})
async function start(input = plan(), status: 'conflict' | 'unavailable' = 'conflict') {
  const guard = await startRemoteRouteGuard(input, status)
  guards.push(guard)
  return guard
}
function exchange(guard: Guard, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(guard.port, guard.address)
    clients.push(socket)
    let received = ''
    socket.setTimeout(1500, () => socket.destroy(new Error('Guard did not promptly close')))
    socket.on('data', data => (received += data.toString()))
    socket.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
    })
    socket.on('close', () => resolve(received))
    socket.on('connect', () => socket.write(request))
  })
}
const get = (host: string) => `GET / HTTP/1.1\r\nHost: ${host}\r\n\r\n`

describe('startRemoteRouteGuard', () => {
  it('binds only ephemeral loopback and rejects POST without waiting for its body', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen')
    const guard = await start()
    expect(listen.mock.calls[0]?.slice(0, 2)).toEqual([0, '127.0.0.1'])
    expect(guard.address).toBe('127.0.0.1')
    const response = await exchange(
      guard,
      'POST / HTTP/1.1\r\nHost: APP.FEATURE.PORT:8080\r\nContent-Length: 999999\r\nExpect: 100-continue\r\n\r\n'
    )
    expect(response).toMatch(/^HTTP\/1.1 409/)
    expect(response).not.toContain('100 Continue')
    expect(response).toContain('Cache-Control: no-store')
    expect(response).toContain('Connection: close')
    expect(response).toContain('Content-Type: application/json')
    expect(JSON.parse(response.split('\r\n\r\n')[1]!)).toEqual({
      status: 'conflict',
      candidates: [
        { owner: { id: 'a', kind: 'local', label: 'Local' }, worktreeId: 'wt-a' },
        { owner: { id: 'b', kind: 'ssh', label: 'Remote' }, worktreeId: 'wt-b' },
      ],
    })
  })

  it('returns exact explicit alternatives in conflict responses', async () => {
    const input = plan()
    input.alternatives = [
      {
        owner: { id: 'a', kind: 'local', label: 'Local' },
        worktreeId: 'wt-a',
        hostname: 'app.feature.local.port',
        port: 8080,
      },
      {
        owner: { id: 'b', kind: 'ssh', label: 'Remote' },
        worktreeId: 'wt-b',
        hostname: 'app.feature.remote.ssh',
        port: 8080,
      },
    ]
    const response = await exchange(await start(input), get(input.hostname))
    expect(JSON.parse(response.split('\r\n\r\n')[1]!)).toMatchObject({
      status: 'conflict',
      candidates: [
        { hostname: 'app.feature.local.port', port: 8080 },
        { hostname: 'app.feature.remote.ssh', port: 8080 },
      ],
    })
  })

  it('returns unavailable for a resolved plan whose backend is not ready', async () => {
    const input = plan()
    input.resolution = {
      status: 'resolved',
      owner: { id: 'a', kind: 'local', label: 'Local' },
      worktreeId: 'wt',
      service: { id: 'private-endpoint', logicalPort: 8080, protocol: 'http' },
    }
    input.endpoint = { ownerId: 'a', worktreeId: 'wt', endpointId: 'private-endpoint' }
    const response = await exchange(await start(input, 'unavailable'), get(input.hostname))
    expect(response).toMatch(/^HTTP\/1.1 503/)
    expect(JSON.parse(response.split('\r\n\r\n')[1]!)).toEqual({ status: 'unavailable' })
  })

  it('matches optional external ports, never the ephemeral internal port', async () => {
    const guard = await start()
    expect(await exchange(guard, get('APP.feature.port'))).toMatch(/^HTTP\/1.1 409/)
    expect(await exchange(guard, get('app.feature.port:8080'))).toMatch(/^HTTP\/1.1 409/)
    expect(guard.port).not.toBe(8080)
    expect(await exchange(guard, get(`app.feature.port:${guard.port}`))).toMatch(/^HTTP\/1.1 421/)
  })

  it.each([
    'wrong.port',
    'app.feature.port:0',
    'app.feature.port:65536',
    'app.feature.port:abc',
    'app.feature.port,evil.port',
    'user@app.feature.port',
    'app.feature.port.',
    '[::1]',
    'app.feature.port\r\nHost: app.feature.port',
  ])('fails closed for Host %s', async host => {
    expect(await exchange(await start(), get(host))).toMatch(/^HTTP\/1.1 (400|421)/)
  })

  it('does not hide duplicate Host behind the default header count limit', async () => {
    const response = await exchange(
      await start(),
      `GET / HTTP/1.1\r\nHost: app.feature.port\r\n${'X: a\r\n'.repeat(2100)}Host: evil.port\r\n\r\n`
    )
    expect(response).toMatch(/^HTTP\/1.1 (400|421)/)
  })

  it('rejects missing Host and oversized headers', async () => {
    const guard = await start()
    expect(await exchange(guard, 'GET / HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1.1 400/)
    expect(
      await exchange(
        guard,
        `GET / HTTP/1.1\r\nHost: app.feature.port\r\nX-Large: ${'x'.repeat(20000)}\r\n\r\n`
      )
    ).toMatch(/^HTTP\/1.1 431/)
  })

  it('snapshots metadata before listen, deduplicates and omits service catalog', async () => {
    const input = plan()
    if (input.resolution.status !== 'conflict') throw new Error('fixture')
    input.resolution.candidates.push(input.resolution.candidates[0]!)
    const pending = start(input)
    input.hostname = 'changed.port'
    input.port = 42
    input.transport = 'tls-sni'
    input.resolution.candidates[0]!.owner.label = 'changed'
    const response = await exchange(await pending, get('app.feature.port:8080'))
    expect(response).toMatch(/^HTTP\/1.1 409/)
    const body = JSON.parse(response.split('\r\n\r\n')[1]!)
    expect(body.candidates).toHaveLength(2)
    expect(response).not.toContain('changed')
    expect(response).not.toContain('services')
  })

  it('never initiates outbound connections, including TLS application rejection', async () => {
    const connect = vi.spyOn(Socket.prototype, 'connect')
    const http = await start()
    const tcp = await start({ ...plan(), transport: 'tls-sni' })
    expect(connect).not.toHaveBeenCalled()
    await exchange(http, get('app.feature.port'))
    expect(await exchange(tcp, 'application bytes')).toBe('')
    expect(connect).toHaveBeenCalledTimes(2) // Only the two test clients.
  })

  it('idempotently closes active clients with incomplete HTTP headers', async () => {
    const guard = await start()
    const client = createConnection(guard.port, guard.address)
    clients.push(client)
    await new Promise<void>(resolve => client.once('connect', resolve))
    client.write('POST / HTTP/1.1\r\nHost:')
    const closed = new Promise<void>(resolve => client.once('close', () => resolve()))
    client.on('error', () => {})
    const first = guard.close()
    expect(guard.close()).toBe(first)
    await first
    await closed
    await guard.close()
  })

  it.each([
    { hostname: '127.0.0.1' },
    { hostname: 'bad..port' },
    { hostname: '-bad.port' },
    { hostname: 'x'.repeat(64) + '.port' },
    { port: 0 },
    { port: 65536 },
    { port: 1.5 },
    { transport: 'tcp' },
    { resolution: { status: 'invalid' } },
  ])('rejects invalid metadata before listen: %j', async patch => {
    const listen = vi.spyOn(Server.prototype, 'listen')
    await expect(
      startRemoteRouteGuard({ ...plan(), ...patch } as RemoteRoutePlan, 'conflict')
    ).rejects.toThrow('Invalid remote route guard')
    expect(listen).not.toHaveBeenCalled()
  })

  it('rejects incorrect statuses and oversized response metadata before listen', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen')
    await expect(startRemoteRouteGuard(plan(), 'unavailable')).rejects.toThrow()
    await expect(startRemoteRouteGuard(plan(), 'bad' as 'conflict')).rejects.toThrow()
    const input = plan()
    input.resolution = {
      status: 'conflict',
      candidates: Array.from({ length: 300 }, (_, i) => ({
        owner: { id: `${i}`, kind: 'ssh', label: 'x'.repeat(4096) },
        worktreeId: 'wt',
        services: [],
      })),
    }
    await expect(startRemoteRouteGuard(input, 'conflict')).rejects.toThrow()
    expect(listen).not.toHaveBeenCalled()
  })
})

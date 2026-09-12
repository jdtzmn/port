import { createConnection, Server, type Socket } from 'node:net'
import { connect } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSecureRemoteRouteGuard } from './guard.ts'
import * as identities from './relayIdentity.ts'
import type { RemoteRoutePlan } from './plan.ts'

const plan = (): RemoteRoutePlan => ({
  namespace: 'feature.port',
  hostname: 'app.feature.port',
  port: 8080,
  transport: 'http',
  resolution: {
    status: 'conflict',
    candidates: [
      { owner: { id: 'a', kind: 'ssh', label: 'Remote' }, worktreeId: 'wt', services: [] },
    ],
  },
})
type Guard = Awaited<ReturnType<typeof startSecureRemoteRouteGuard>>
const guards: Guard[] = []
const clients: Socket[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(guards.splice(0).map(guard => guard.close()))
  for (const client of clients.splice(0)) client.destroy()
})
async function start(input = plan(), status: 'conflict' | 'unavailable' = 'conflict') {
  const guard = await startSecureRemoteRouteGuard(input, status)
  guards.push(guard)
  return guard
}
function client(guard: Guard, pin = guard.tls.certificatePem) {
  const socket = connect({
    host: guard.address,
    port: guard.port,
    servername: guard.tls.serverName,
    ca: pin,
    rejectUnauthorized: true,
  })
  clients.push(socket)
  return socket
}
function exchange(guard: Guard, request: string, pin = guard.tls.certificatePem) {
  return new Promise<{ bytes: string; secure: boolean; error?: Error }>(resolve => {
    const socket = client(guard, pin)
    let bytes = ''
    let secure = false
    let error: Error | undefined
    socket.setTimeout(2000, () => socket.destroy(new Error('Guard failed to close')))
    socket.on('secureConnect', () => {
      secure = true
      if (request) socket.write(request)
    })
    socket.on('data', data => (bytes += data.toString()))
    socket.on('error', value => (error = value))
    socket.on('close', () => resolve({ bytes, secure, error }))
  })
}
const get = (host = 'app.feature.port:8080') => `GET / HTTP/1.1\r\nHost: ${host}\r\n\r\n`

describe('secure remote route guard', () => {
  it.each(['close', 'error', 'shutdown'])('reports listener liveness after %s', async mode => {
    const listen = vi.spyOn(Server.prototype, 'listen')
    const guard = await startSecureRemoteRouteGuard(plan(), 'conflict')
    const server = listen.mock.instances.at(-1) as Server
    expect(guard.isAlive()).toBe(true)
    if (mode === 'shutdown') {
      await new Promise<void>(resolve => server.close(() => resolve()))
    } else {
      if (mode === 'error') server.emit('error', new Error('runtime failure'))
      const closing = guard.close()
      expect(guard.isAlive()).toBe(false)
      await closing
    }
    expect(guard.isAlive()).toBe(false)
  })

  it('serves pinned HTTPS conflict without draining POST or sending Continue', async () => {
    const result = await exchange(
      await start(),
      'POST / HTTP/1.1\r\nHost: APP.FEATURE.PORT:8080\r\nContent-Length: 999999\r\nExpect: 100-continue\r\n\r\n'
    )
    expect(result.secure).toBe(true)
    expect(result.bytes).toMatch(/^HTTP\/1.1 409/)
    expect(result.bytes).toContain('Cache-Control: no-store')
    expect(result.bytes).not.toContain('100 Continue')
    expect(JSON.parse(result.bytes.split('\r\n\r\n')[1]!)).toEqual({
      status: 'conflict',
      candidates: [{ owner: { id: 'a', kind: 'ssh', label: 'Remote' }, worktreeId: 'wt' }],
    })
  })

  it('serves pinned HTTPS unavailable', async () => {
    const input = plan()
    input.resolution = { status: 'unavailable' }
    const result = await exchange(await start(input, 'unavailable'), get())
    expect(result.secure).toBe(true)
    expect(result.bytes).toMatch(/^HTTP\/1.1 503/)
    expect(JSON.parse(result.bytes.split('\r\n\r\n')[1]!)).toEqual({ status: 'unavailable' })
  })

  it('uses external Host ports and rejects wrong or duplicate Host', async () => {
    const guard = await start()
    for (const host of ['APP.feature.port', 'app.feature.port:8080']) {
      expect((await exchange(guard, get(host))).bytes).toMatch(/^HTTP\/1.1 409/)
    }
    for (const host of [
      'wrong.port',
      `app.feature.port:${guard.port}`,
      'app.feature.port\r\nHost: app.feature.port',
    ]) {
      expect((await exchange(guard, get(host))).bytes).toMatch(/^HTTP\/1.1 (400|421)/)
    }
    expect(
      (
        await exchange(
          guard,
          `GET / HTTP/1.1\r\nHost: app.feature.port\r\n${'X: a\r\n'.repeat(2100)}Host: evil.port\r\n\r\n`
        )
      ).bytes
    ).toMatch(/^HTTP\/1.1 400/)
  })

  it('completes pinned TLS then closes TCP guard with zero application bytes', async () => {
    const guard = await start({ ...plan(), transport: 'tls-sni' })
    const result = await exchange(guard, '')
    expect(result.secure).toBe(true)
    expect(result.bytes).toBe('')
    expect(result.error?.message).not.toBe('Guard failed to close')
  })

  it('rejects a different identity pin before any application bytes', async () => {
    const guard = await start()
    const other = await start()
    const result = await exchange(guard, get(), other.tls.certificatePem)
    expect(result.secure).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.bytes).toBe('')
    expect(guard.tls.serverName).not.toBe(other.tls.serverName)
    expect(guard.tls.certificatePem).not.toBe(other.tls.certificatePem)
    expect(guard.expiresAt).toBeGreaterThan(Date.now())
    expect(Object.keys(guard).sort()).toEqual([
      'address',
      'close',
      'expiresAt',
      'isAlive',
      'port',
      'tls',
    ])
    expect(Object.keys(guard.tls).sort()).toEqual(['certificatePem', 'serverName'])
    expect(JSON.stringify(guard)).not.toContain('PRIVATE KEY')
  })

  it('closes active HTTPS and incomplete TLS idempotently', async () => {
    const guard = await start()
    const active = client(guard)
    active.on('error', () => {})
    await new Promise<void>(resolve => active.once('secureConnect', resolve))
    active.write('POST / HTTP/1.1\r\nHost:')
    const raw = createConnection(guard.port, guard.address)
    clients.push(raw)
    raw.on('error', () => {})
    await new Promise<void>(resolve => raw.once('connect', resolve))
    raw.write(Buffer.from([0x16, 0x03, 0x01]))
    const closed = Promise.all(
      [active, raw].map(
        socket => new Promise<void>(resolve => socket.once('close', () => resolve()))
      )
    )
    const first = guard.close()
    expect(guard.close()).toBe(first)
    await first
    await closed
    await guard.close()
  })

  it('validates metadata and bind before identity generation or listen', async () => {
    const identity = vi.spyOn(identities, 'createRemoteRelayIdentity')
    const listen = vi.spyOn(Server.prototype, 'listen')
    await expect(startSecureRemoteRouteGuard({ ...plan(), port: 0 }, 'conflict')).rejects.toThrow()
    await expect(startSecureRemoteRouteGuard(plan(), 'unavailable')).rejects.toThrow()
    await expect(
      startSecureRemoteRouteGuard(plan(), 'conflict', {
        kind: 'docker-bridge',
        address: '0.0.0.0',
        peerAddress: '172.17.0.2',
      })
    ).rejects.toThrow()
    expect(identity).not.toHaveBeenCalled()
    expect(listen).not.toHaveBeenCalled()
  })

  it('snapshots caller metadata before identity generation', async () => {
    const input = plan()
    const pending = start(input)
    input.hostname = 'changed.port'
    input.port = 42
    if (input.resolution.status === 'conflict')
      input.resolution.candidates[0]!.owner.label = 'changed'
    const result = await exchange(await pending, get())
    expect(result.bytes).toMatch(/^HTTP\/1.1 409/)
    expect(result.bytes).not.toContain('changed')
  })
})

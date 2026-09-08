import * as net from 'node:net'
import * as tls from 'node:tls'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { startSecureRemoteRelay } from './remoteRelay'

type Relay = Awaited<ReturnType<typeof startSecureRemoteRelay>>
const cleanup: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  for (const close of cleanup.reverse()) await close()
  cleanup.length = 0
})
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const closed = (socket: net.Socket) =>
  new Promise<void>(resolve => socket.once('close', () => resolve()))

async function relay(connect: () => net.Socket | null = () => null, maxConnections?: number) {
  const result = await startSecureRemoteRelay({
    bind: { kind: 'loopback' },
    stream: { connect },
    maxConnections,
  })
  cleanup.push(() => result.close())
  return result
}
function client(relay: Relay, ca = relay.tls.certificatePem) {
  const options = {
    host: relay.address,
    port: relay.port,
    ca,
    servername: relay.tls.serverName,
    ALPNProtocols: ['http/1.1'],
    allowHalfOpen: true,
  }
  const socket = tls.connect(options)
  socket.on('error', () => {})
  cleanup.push(() => {
    socket.destroy()
  })
  return socket
}
async function echo() {
  const directory = await mkdtemp(join(tmpdir(), 'relay-test-'))
  const path = join(directory, 'echo.sock')
  const sockets = new Set<net.Socket>()
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    socket.pipe(socket)
  })
  await new Promise<void>(resolve => server.listen(path, resolve))
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })
  return vi.fn(() => net.createConnection({ path, allowHalfOpen: true }))
}

it('uses pinned TLS/SNI and the captured bound Unix stream capability', async () => {
  const connect = await echo()
  const stream = {
    connect() {
      expect(this).toBe(stream)
      return connect()
    },
  }
  const result = await startSecureRemoteRelay({ bind: { kind: 'loopback' }, stream })
  cleanup.push(() => result.close())
  stream.connect = () => {
    throw new Error('mutated')
  }
  const socket = client(result)
  await once(socket, 'secureConnect')
  expect(socket.authorized).toBe(true)
  expect(socket.alpnProtocol).toBe('http/1.1')
  socket.write('hello')
  expect((await once(socket, 'data'))[0].toString()).toBe('hello')
  expect(connect).toHaveBeenCalledTimes(1)
})

it('creates distinct identities per incarnation and never returns private keys', async () => {
  const a = await relay()
  const b = await relay()
  expect(a.tls.serverName).not.toBe(b.tls.serverName)
  expect(a.tls.certificatePem).not.toBe(b.tls.certificatePem)
  expect(Object.keys(a.tls).sort()).toEqual(['certificatePem', 'serverName'])
  expect(Object.keys(a).sort()).toEqual(['address', 'close', 'expiresAt', 'port', 'tls'])
  expect(JSON.stringify(a)).not.toContain('PRIVATE KEY')
  expect(a.expiresAt).toBeGreaterThan(Date.now())
})

it('wrong pin sends no sentinel application bytes', async () => {
  const connect = await echo()
  const result = await relay(connect)
  const unrelated = await relay()
  const socket = client(result, unrelated.tls.certificatePem)
  const send = vi.fn(() => socket.write('SENTINEL'))
  socket.once('secureConnect', send)
  await closed(socket)
  expect(send).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
})

it('plaintext and incomplete handshakes never contact the stream; close destroys stalled TLS', async () => {
  const connect = vi.fn(() => null)
  const result = await relay(connect)
  const plain = net.connect(result.port, result.address)
  plain.on('error', () => {})
  const plainClosed = closed(plain)
  plain.write('GET / HTTP/1.1\r\n\r\n')
  await plainClosed
  const stalled = net.connect(result.port, result.address)
  stalled.on('error', () => {})
  await once(stalled, 'connect')
  const stalledClosed = closed(stalled)
  const first = result.close()
  expect(result.close()).toBe(first)
  await Promise.all([first, stalledClosed])
  expect(connect).not.toHaveBeenCalled()
})

it.each(['null', 'throw'])('fails closed for stream %s', async mode => {
  const connect = vi.fn(() => {
    if (mode === 'throw') throw new Error('unavailable')
    return null
  })
  const socket = client(await relay(connect))
  socket.resume()
  socket.on('end', () => socket.end())
  await closed(socket)
  expect(connect).toHaveBeenCalledTimes(1)
})

it('counts incomplete handshakes against the strict cap and expires them', async () => {
  const connect = await echo()
  const result = await relay(connect, 1)
  const stalled = net.connect(result.port, result.address)
  stalled.on('error', () => {})
  cleanup.push(() => {
    stalled.destroy()
  })
  await once(stalled, 'connect')
  const stalledClosed = closed(stalled)
  const excess = client(result)
  await closed(excess)
  expect(connect).not.toHaveBeenCalled()
  await stalledClosed
  const accepted = client(result)
  await once(accepted, 'secureConnect')
  accepted.write('ok')
  expect((await once(accepted, 'data'))[0].toString()).toBe('ok')
}, 10000)

it('caps active clients and close destroys clients and upstream sockets', async () => {
  const connect = await echo()
  const result = await relay(connect, 1)
  const socket = client(result)
  await once(socket, 'secureConnect')
  socket.write('ready')
  await once(socket, 'data')
  await closed(client(result))
  expect(connect).toHaveBeenCalledTimes(1)
  socket.resume()
  socket.on('end', () => socket.end())
  const done = closed(socket)
  await result.close()
  await done
  expect(connect.mock.results[0]!.value.destroyed).toBe(true)
})

it('preserves backpressure and half-close while draining a large response', async () => {
  const socket = client(await relay(await echo()))
  await once(socket, 'secureConnect')
  const payload = Buffer.alloc(4 * 1024 * 1024, 120)
  const chunks: Buffer[] = []
  socket.pause()
  socket.end(payload)
  await delay(100)
  socket.on('data', chunk => chunks.push(chunk))
  const ended = once(socket, 'end')
  socket.resume()
  await ended
  expect(Buffer.concat(chunks).equals(payload)).toBe(true)
}, 15000)

it('does not impose an idle deadline after upstream connection', async () => {
  const socket = client(await relay(await echo()))
  await once(socket, 'secureConnect')
  socket.write('before')
  await once(socket, 'data')
  await delay(5300)
  socket.write('after')
  expect((await once(socket, 'data'))[0].toString()).toBe('after')
}, 10000)

it('rejects invalid bind, caps, and stream capabilities before listening', async () => {
  await expect(
    startSecureRemoteRelay({
      bind: { kind: 'docker-bridge', address: '0.0.0.0', peerAddress: '10.1.2.3' },
      stream: { connect: () => null },
    })
  ).rejects.toThrow('bridge')
  await expect(relay(() => null, 0)).rejects.toThrow('maxConnections')
  await expect(
    startSecureRemoteRelay({ bind: { kind: 'loopback' }, stream: {} as never })
  ).rejects.toThrow('stream.connect')
})

it('expires an upstream that never completes connection', async () => {
  const upstream = new net.Socket({ allowHalfOpen: true })
  // Model a capability whose pending Unix connection never signals connect.
  Object.defineProperty(upstream, 'connecting', { value: true, writable: true })
  const socket = client(await relay(() => upstream))
  socket.resume()
  socket.on('end', () => socket.end())
  await closed(socket)
  expect(upstream.destroyed).toBe(true)
}, 10000)

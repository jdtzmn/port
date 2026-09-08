import * as http from 'node:http'
import * as net from 'node:net'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startRouteIngress, type RouteIngressOptions } from './routeIngress'
import type { RouteResolution } from './routeOwnership'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const route = (id: string, protocol: 'http' | 'tcp' = 'http'): RouteResolution => ({
  status: 'resolved',
  owner: { id, kind: 'ssh', label: `Machine ${id}` },
  worktreeId: `tree-${id}`,
  service: { id: 'web', name: 'web', logicalPort: 8080, protocol },
})
const conflict: RouteResolution = {
  status: 'conflict',
  candidates: ['a', 'b'].map(id => {
    const resolved = route(id) as Extract<RouteResolution, { status: 'resolved' }>
    return { owner: resolved.owner, worktreeId: resolved.worktreeId, services: [resolved.service] }
  }),
}

async function listen(server: net.Server) {
  const sockets = new Set<net.Socket>()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        for (const socket of sockets) socket.destroy()
      })
  )
  return { address: '127.0.0.1', port: (server.address() as net.AddressInfo).port }
}
async function ingress(overrides: Partial<RouteIngressOptions> = {}) {
  const result = await startRouteIngress({
    address: '127.0.0.1',
    port: 0,
    hostname: 'web.demo.local',
    protocol: 'http',
    resolve: () => route('a'),
    backend: () => undefined,
    ...overrides,
  })
  cleanup.push(result.close)
  return result
}
function request(port: number, options: http.RequestOptions = {}, body = '') {
  return new Promise<{
    status: number
    body: string
    headers: http.IncomingHttpHeaders
    socket: net.Socket
  }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, headers: { host: 'web.demo.local' }, ...options },
      res => {
        const chunks: Buffer[] = []
        const socket = res.socket
        res.on('data', chunk => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
            socket,
          })
        )
      }
    )
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('Request timed out')))
    req.end(body)
  })
}
function connect(port: number) {
  const socket = net.connect(port, '127.0.0.1')
  socket.on('error', () => {})
  cleanup.push(() => {
    socket.destroy()
  })
  return socket
}
function closed(socket: net.Socket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket did not close')), 2000)
    socket.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.resume()
  })
}
function bytes(socket: net.Socket, complete: (data: Buffer) => boolean) {
  return new Promise<Buffer>((resolve, reject) => {
    let data = Buffer.alloc(0)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
      if (error) reject(error)
      else resolve(data)
    }
    const onData = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      if (complete(data)) finish()
    }
    const onError = (error: Error) => finish(error)
    const onClose = () => finish(new Error('Closed before expected bytes'))
    const timer = setTimeout(() => finish(new Error('Expected bytes timed out')), 2000)
    socket.on('data', onData).once('error', onError).once('close', onClose)
  })
}

describe('route ingress', () => {
  it('rechecks keepalive requests and blocks conflicting POST before any forwarding', async () => {
    const counts = { a: 0, b: 0 }
    const targets = {} as Record<'a' | 'b', { address: string; port: number }>
    for (const id of ['a', 'b'] as const)
      targets[id] = await listen(
        http.createServer((req, res) => {
          counts[id]++
          let body = ''
          req.on('data', chunk => {
            body += chunk
          })
          req.on('end', () => {
            res.writeHead(302, {
              location: '/unchanged',
              'set-cookie': ['one=1; Path=/', 'two=2'],
              connection: 'x-private',
              'x-private': 'secret',
            })
            res.end(
              JSON.stringify({
                id,
                method: req.method,
                path: req.url,
                host: req.headers.host,
                body,
                private: req.headers['x-private'],
              })
            )
          })
        })
      )
    let current = route('a')
    const gateway = await ingress({
      resolve: () => current,
      backend: r => targets[r.owner.id as 'a' | 'b'],
    })
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    cleanup.push(() => agent.destroy())
    const first = await request(gateway.port, { agent })
    expect(JSON.parse(first.body).id).toBe('a')
    current = conflict
    const blocked = await request(gateway.port, { agent, method: 'POST' }, 'must-not-arrive')
    expect(blocked.socket).toBe(first.socket)
    expect(blocked.status).toBe(409)
    expect(blocked.headers['content-type']).toBe('application/json')
    expect(JSON.parse(blocked.body)).toEqual(conflict)
    expect(counts).toEqual({ a: 1, b: 0 })
    current = route('b')
    const second = await request(
      gateway.port,
      {
        agent,
        method: 'POST',
        path: '/hello?q=1',
        headers: {
          host: `WEB.DEMO.LOCAL:${gateway.port}`,
          connection: 'keep-alive, x-private',
          'x-private': 'strip',
        },
      },
      'payload'
    )
    expect(second.status).toBe(302)
    expect(second.headers.location).toBe('/unchanged')
    expect(second.headers['set-cookie']).toEqual(['one=1; Path=/', 'two=2'])
    expect(second.headers['x-private']).toBeUndefined()
    expect(JSON.parse(second.body)).toEqual({
      id: 'b',
      method: 'POST',
      path: '/hello?q=1',
      host: `WEB.DEMO.LOCAL:${gateway.port}`,
      body: 'payload',
    })
    expect(counts).toEqual({ a: 1, b: 1 })
  })

  it('rejects wrong/malformed Host before resolution and handles unavailable or invalid targets', async () => {
    let resolutions = 0
    let current = route('a')
    let target: { address: string; port: number } | undefined
    const gateway = await ingress({
      resolve: () => {
        resolutions++
        return current
      },
      backend: () => target,
    })
    for (const host of [
      'elsewhere.local',
      'web.demo.local:1',
      'user@web.demo.local',
      'web.demo.local/path',
      'web.demo.local:',
      '[127.0.0.1]',
    ]) {
      expect((await request(gateway.port, { headers: { host } })).status).toBe(404)
    }
    expect(resolutions).toBe(0)
    for (const status of ['invalid', 'unavailable'] as const) {
      current = { status }
      expect((await request(gateway.port)).status).toBe(503)
    }
    current = route('a')
    for (const value of [
      undefined,
      { address: 'localhost', port: 80 },
      { address: '0.0.0.0', port: 80 },
      { address: '192.0.2.1', port: 80 },
      { address: '127.0.0.1', port: 0 },
      { address: '127.0.0.1', port: 65536 },
    ]) {
      target = value
      expect((await request(gateway.port)).status).toBe(503)
    }
    // A listening non-HTTP peer gives deterministic upstream failure without a port race.
    target = await listen(net.createServer(socket => socket.destroy()))
    expect((await request(gateway.port)).status).toBe(503)
  })

  it('rejects non-loopback listen addresses', async () => {
    for (const address of ['0.0.0.0', '::1', 'localhost', '192.0.2.1']) {
      await expect(
        startRouteIngress({
          address,
          port: 0,
          hostname: 'web.demo.local',
          protocol: 'tcp',
          resolve: () => route('a'),
          backend: () => undefined,
        })
      ).rejects.toThrow('Invalid route ingress')
    }
  })

  it('pins established TCP streams while refusing conflicting new connections without backend contact', async () => {
    const counts = { a: 0, b: 0 }
    const targets = {} as Record<'a' | 'b', { address: string; port: number }>
    for (const id of ['a', 'b'] as const)
      targets[id] = await listen(
        net.createServer(socket => {
          counts[id]++
          socket.on('data', data => socket.write(`${id}:${data}`))
        })
      )
    let current = route('a', 'tcp')
    let lookups = 0
    const gateway = await ingress({
      protocol: 'tcp',
      resolve: () => current,
      backend: r => {
        lookups++
        return targets[r.owner.id as 'a' | 'b']
      },
    })
    const first = connect(gateway.port)
    let received = bytes(first, data => data.toString() === 'a:one')
    first.write('one')
    await received
    current = conflict
    await closed(connect(gateway.port))
    expect(lookups).toBe(1)
    received = bytes(first, data => data.toString() === 'a:two')
    first.write('two')
    await received
    for (const status of ['invalid', 'unavailable'] as const) {
      current = { status }
      await closed(connect(gateway.port))
    }
    expect(counts).toEqual({ a: 1, b: 0 })
    current = route('b', 'tcp')
    const second = connect(gateway.port)
    received = bytes(second, data => data.toString() === 'b:three')
    second.write('three')
    await received
    const firstClosed = closed(first)
    const secondClosed = closed(second)
    await gateway.close()
    await Promise.all([firstClosed, secondClosed])
    expect(counts).toEqual({ a: 1, b: 1 })
  })

  it('upgrades WebSocket and pipes frames, but never upgrades a conflicting route', async () => {
    let upgrades = 0
    const backend = http.createServer((_, res) => res.end('not an upgrade'))
    backend.on('upgrade', (req, socket, head) => {
      upgrades++
      const accept = createHash('sha1')
        .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
      )
      const echo = (frame: Buffer) => {
        const payload = Buffer.from(frame.subarray(6))
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ frame[2 + (i % 4)]!
        socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]))
      }
      // The fixture accepts one short masked frame, possibly split across packets.
      let pending = head
      socket.on('data', chunk => {
        pending = Buffer.concat([pending, chunk])
        if (pending.length >= 8) {
          echo(pending)
          pending = Buffer.alloc(0)
        }
      })
      if (head.length >= 8) {
        echo(head)
        pending = Buffer.alloc(0)
      }
    })
    const target = await listen(backend)
    let current = route('a')
    const gateway = await ingress({ resolve: () => current, backend: () => target })
    const handshake =
      'GET /socket HTTP/1.1\r\nHost: web.demo.local\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
    const client = connect(gateway.port)
    const upgraded = bytes(client, data => data.includes('\r\n\r\n'))
    client.write(handshake)
    expect((await upgraded).toString()).toContain('101 Switching Protocols')
    const echoed = bytes(client, data => data.length >= 4)
    client.write(Buffer.from([0x81, 0x82, 1, 2, 3, 4, 104 ^ 1, 105 ^ 2]))
    expect(await echoed).toEqual(Buffer.from([0x81, 2, 104, 105]))
    current = conflict
    const blocked = connect(gateway.port)
    const rejected = bytes(blocked, data => data.includes('\r\n\r\n'))
    blocked.write(handshake)
    expect((await rejected).toString()).toContain('409 Conflict')
    expect(upgrades).toBe(1)
    const done = closed(client)
    await gateway.close()
    await done
  })
})

import * as net from 'node:net'
import * as os from 'node:os'
import { once } from 'node:events'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('node:net', async importOriginal => {
  const actual = await importOriginal<typeof import('node:net')>()
  return { ...actual, createServer: vi.fn(actual.createServer) }
})
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, networkInterfaces: vi.fn(actual.networkInterfaces) }
})
import { startRemoteRelay } from './relay.ts'

const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
  vi.mocked(net.createServer).mockClear()
  vi.mocked(os.networkInterfaces).mockReset()
})

async function backend(handler: (socket: net.Socket) => void) {
  const sockets = new Set<net.Socket>()
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    handler(socket)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>(resolve => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      })
  )
  return { server, port: (server.address() as net.AddressInfo).port }
}

async function relay(targetPort: number, maxConnections?: number) {
  const result = await startRemoteRelay({ targetPort, bind: { kind: 'loopback' }, maxConnections })
  cleanups.push(result.close)
  return result
}

async function client(port: number) {
  const socket = net.connect({ host: '127.0.0.1', port, allowHalfOpen: true })
  socket.on('error', () => {})
  cleanups.push(() => {
    socket.destroy()
  })
  await once(socket, 'connect')
  return socket
}

function receive(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    socket.on('data', chunk => chunks.push(chunk))
    socket.once('end', () => resolve(Buffer.concat(chunks)))
    socket.once('error', reject)
  })
}

test('relays binary bytes with backpressure and client half-close without truncation', async () => {
  const target = await backend(socket => socket.pipe(socket))
  const transport = await relay(target.port)
  expect(transport.address).toBe('127.0.0.1')
  expect(transport.port).toBeGreaterThan(1023)
  const socket = await client(transport.port)
  const payload = Buffer.alloc(4 * 1024 * 1024)
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251
  socket.pause()
  const result = receive(socket)
  expect(socket.write(payload)).toBe(false)
  socket.end()
  socket.resume()
  expect((await result).equals(payload)).toBe(true)
}, 15000)

test('backend half-close still allows client bytes in the other direction', async () => {
  let resolveBytes!: (bytes: Buffer) => void
  const bytes = new Promise<Buffer>(resolve => {
    resolveBytes = resolve
  })
  const target = await backend(socket => {
    void receive(socket).then(resolveBytes)
    socket.end('greeting')
  })
  const transport = await relay(target.port)
  const socket = await client(transport.port)
  expect((await receive(socket)).toString()).toBe('greeting')
  socket.end('after FIN')
  expect((await bytes).toString()).toBe('after FIN')
})

test('close is idempotent, destroys both sides and stops listening', async () => {
  const target = await backend(() => {})
  const transport = await relay(target.port)
  const connected = once(target.server, 'connection')
  const socket = await client(transport.port)
  const [upstream] = (await connected) as [net.Socket]
  const upstreamEnd = once(upstream, 'end')
  upstream.resume()
  const downstreamEnd = once(socket, 'end')
  socket.resume()
  const first = transport.close()
  expect(transport.close()).toBe(first)
  await first
  await Promise.all([upstreamEnd, downstreamEnd])
  const refused = net.connect({ host: transport.address, port: transport.port })
  cleanups.push(() => {
    refused.destroy()
  })
  const [error] = await once(refused, 'error')
  expect(error.code).toBe('ECONNREFUSED')
})

test('connection bound rejects before contacting backend and releases capacity', async () => {
  let contacts = 0
  const target = await backend(socket => {
    contacts++
    socket.pipe(socket)
  })
  const transport = await relay(target.port, 1)
  const connected = once(target.server, 'connection')
  const first = await client(transport.port)
  await connected
  const rejected = await client(transport.port)
  expect(await receive(rejected)).toEqual(Buffer.alloc(0))
  expect(contacts).toBe(1)
  const finished = receive(first)
  first.end()
  await finished
  await once(first, 'close')
  // Let both relay close events release the owned pair before admission.
  await new Promise(resolve => setImmediate(resolve))
  const nextContact = once(target.server, 'connection')
  const next = await client(transport.port)
  await nextContact
  expect(contacts).toBe(2)
  next.end()
})

test.each([0, -1, 65536, 1.5, NaN, Infinity, '80'])(
  'invalid target %s fails before I/O',
  async targetPort => {
    const before = vi.mocked(net.createServer).mock.calls.length
    await expect(
      startRemoteRelay({ targetPort: targetPort as number, bind: { kind: 'loopback' } })
    ).rejects.toThrow('targetPort')
    expect(net.createServer).toHaveBeenCalledTimes(before)
    expect(os.networkInterfaces).not.toHaveBeenCalled()
  }
)

test.each([0, -1, 4097, 1.5, NaN, Infinity])(
  'invalid connection bound %s fails before listen',
  async maxConnections => {
    await expect(relay(80, maxConnections)).rejects.toThrow('maxConnections')
    expect(net.createServer).not.toHaveBeenCalled()
  }
)

test.each([1, 4096])('accepts connection bound endpoint %s', async max => {
  await relay(65535, max)
})

const bridge = { kind: 'docker-bridge' as const, address: '172.18.0.1', peerAddress: '172.18.0.2' }
function localBridge() {
  vi.mocked(os.networkInterfaces).mockReturnValue({
    docker0: [
      {
        address: bridge.address,
        family: 'IPv4',
        netmask: '255.255.0.0',
        internal: false,
        mac: '00:00:00:00:00:00',
        cidr: '172.18.0.1/16',
      },
    ],
  })
}

test.each([
  '0.0.0.0',
  '8.8.8.8',
  '127.0.0.1',
  'localhost',
  '172.32.0.1',
  '::ffff:172.18.0.1',
  '10.01.0.1',
])('rejects unsafe/nonliteral bridge address %s', async address => {
  localBridge()
  await expect(startRemoteRelay({ targetPort: 80, bind: { ...bridge, address } })).rejects.toThrow(
    'RFC1918'
  )
  expect(net.createServer).not.toHaveBeenCalled()
})

test.each(['172.18.0.1', '0.0.0.0', '8.8.8.8', 'localhost', '::ffff:172.18.0.2'])(
  'rejects unsafe bridge peer %s',
  async peerAddress => {
    localBridge()
    await expect(
      startRemoteRelay({ targetPort: 80, bind: { ...bridge, peerAddress } })
    ).rejects.toThrow('RFC1918')
    expect(net.createServer).not.toHaveBeenCalled()
  }
)

test('rejects nonlocal private bridge address without a listen fallback', async () => {
  vi.mocked(os.networkInterfaces).mockReturnValue({})
  await expect(startRemoteRelay({ targetPort: 80, bind: bridge })).rejects.toThrow(
    'local interface'
  )
  expect(net.createServer).not.toHaveBeenCalled()
})

test.each([undefined, '192.168.1.50', '172.18.0.3', '127.0.0.1', '::ffff:172.18.0.3'])(
  'bridge rejects event peer %s before upstream contact',
  async remoteAddress => {
    localBridge()
    let contacts = 0
    const target = await backend(() => {
      contacts++
    })
    // Mock only binding: no claim this exercises an actual Docker bridge.
    const server = new net.Server()
    vi.spyOn(server, 'listen').mockImplementation((...args: unknown[]) => {
      queueMicrotask(args.at(-1) as () => void)
      return server
    })
    vi.spyOn(server, 'address').mockReturnValue({
      address: bridge.address,
      family: 'IPv4',
      port: 49152,
    })
    vi.mocked(net.createServer).mockImplementationOnce((options, listener) => {
      server.on('connection', listener!)
      return server
    })
    const transport = await startRemoteRelay({ targetPort: target.port, bind: bridge })
    const upstreamConnect = vi.spyOn(net.Socket.prototype, 'connect')
    const socket = new net.Socket()
    Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress })
    server.emit('connection', socket)
    expect(socket.destroyed).toBe(true)
    expect(upstreamConnect).not.toHaveBeenCalled()
    await new Promise(resolve => setImmediate(resolve))
    expect(contacts).toBe(0)
    // Mock listener never actually listened; avoid invoking its real close.
    vi.spyOn(server, 'close').mockImplementation(callback => {
      callback?.()
      return server
    })
    await transport.close()
  }
)

test.each(['::ffff:127.0.0.1', '::FFFF:127.0.0.1'])(
  'accepts mapped loopback %s',
  async remoteAddress => {
    const target = await backend(socket => socket.pipe(socket))
    const transport = await relay(target.port)
    const server = vi.mocked(net.createServer).mock.results.at(-1)!.value as net.Server
    server.prependListener('connection', socket => {
      Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress })
    })
    const socket = await client(transport.port)
    const response = receive(socket)
    socket.end('mapped')
    expect((await response).toString()).toBe('mapped')
  }
)

test('upstream refusal closes client without protocol bytes', async () => {
  const target = await backend(() => {})
  await new Promise<void>(resolve => target.server.close(() => resolve()))
  const transport = await relay(target.port)
  const socket = await client(transport.port)
  expect(await receive(socket)).toEqual(Buffer.alloc(0))
})

test.each(['172.18.0.2', '::ffff:172.18.0.2'])(
  'bridge admits exact event peer %s and keeps target fixed to loopback',
  async remoteAddress => {
    localBridge()
    const target = await backend(socket => socket.pipe(socket))
    vi.mocked(net.createServer).mockImplementationOnce((options, listener) => {
      const server = new net.Server(options, socket => {
        Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress })
        listener!(socket)
      })
      const listen = server.listen.bind(server)
      vi.spyOn(server, 'listen').mockImplementation((...args: unknown[]) => {
        expect(args[0]).toEqual({ host: bridge.address, port: 0, exclusive: true })
        // Synthetic bridge peer on real loopback transport, not Docker E2E.
        return listen({ host: '127.0.0.1', port: 0 }, args[1] as () => void)
      })
      return server
    })
    const transport = await startRemoteRelay({ targetPort: target.port, bind: bridge })
    cleanups.push(transport.close)
    const connect = vi.spyOn(net.Socket.prototype, 'connect')
    const socket = await client(transport.port)
    const response = receive(socket)
    socket.end('bridge')
    expect((await response).toString()).toBe('bridge')
    expect(connect).toHaveBeenCalledWith({ host: '127.0.0.1', port: target.port })
  }
)

test.each(['deadline', 'shutdown'])('cleans pending upstream on %s', async mode => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const transport = await relay(80)
  const server = vi.mocked(net.createServer).mock.results.at(-1)!.value as net.Server
  const connect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
    this: net.Socket
  ) {
    return this
  })
  const socket = new net.Socket({ allowHalfOpen: true })
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' })
  server.emit('connection', socket)
  const upstream = connect.mock.instances[0]! as net.Socket
  expect(socket.destroyed).toBe(false)
  if (mode === 'deadline') {
    await vi.advanceTimersByTimeAsync(4999)
    expect(socket.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
  } else {
    await transport.close()
  }
  expect(socket.destroyed).toBe(true)
  expect(upstream.destroyed).toBe(true)
})

test('does not impose an idle timeout after upstream connection', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const target = await backend(socket => socket.pipe(socket))
  const transport = await relay(target.port)
  const socket = await client(transport.port)
  const first = once(socket, 'data')
  socket.write('ready')
  await first
  await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
  const response = receive(socket)
  socket.end('still alive')
  expect((await response).toString()).toBe('still alive')
})

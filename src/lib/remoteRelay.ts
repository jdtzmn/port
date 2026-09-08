import * as net from 'node:net'
import * as os from 'node:os'
import * as tls from 'node:tls'
import { createRemoteRelayIdentity } from './remoteRelayIdentity'

export interface RemoteRelayOptions {
  targetPort: number
  bind: { kind: 'loopback' } | { kind: 'docker-bridge'; address: string; peerAddress: string }
  maxConnections?: number
}

export interface RemoteRelay {
  address: string
  port: number
  close(): Promise<void>
}

function privateIPv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false
  const [first, second] = address.split('.').map(Number)
  return (
    first === 10 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  )
}

function normalizePeer(address: string | undefined): string {
  const value = address?.toLowerCase() ?? ''
  return value.startsWith('::ffff:') ? value.slice(7) : value
}

export function validateBind(bind: RemoteRelayOptions['bind']): string {
  if (bind?.kind === 'loopback') return '127.0.0.1'
  if (
    bind?.kind !== 'docker-bridge' ||
    !privateIPv4(bind.address) ||
    !privateIPv4(bind.peerAddress) ||
    bind.address === bind.peerAddress
  ) {
    throw new Error('Relay bridge bind and peer must be distinct literal RFC1918 IPv4 addresses')
  }
  const local = Object.values(os.networkInterfaces()).some(entries =>
    entries?.some(entry => entry.family === 'IPv4' && entry.address === bind.address)
  )
  if (!local) throw new Error('Relay bridge bind address must belong to a local interface')
  return bind.address
}

export function allowedPeer(address: string | undefined, peerAddress: string | undefined): boolean {
  const peer = normalizePeer(address)
  return peerAddress !== undefined
    ? peer === peerAddress
    : net.isIP(peer) === 4 && peer.startsWith('127.')
}

/** UNSAFE for persistent publication. Legacy internal TCP transport only,
 * not an authentication boundary against local users/root.
 * Bridge callers must supply the exact locally inspected Traefik container IP.
 * No idle deadline: database sessions may remain idle indefinitely.
 */
export async function startRemoteRelay(options: RemoteRelayOptions): Promise<RemoteRelay> {
  if (
    !Number.isInteger(options.targetPort) ||
    options.targetPort < 1 ||
    options.targetPort > 65535
  ) {
    throw new Error('Relay targetPort must be an integer between 1 and 65535')
  }
  const maxConnections = options.maxConnections ?? 256
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 4096) {
    throw new Error('Relay maxConnections must be an integer between 1 and 4096')
  }
  const address = validateBind(options.bind)
  // Snapshot options so caller mutation cannot broaden the peer policy or target.
  const peerAddress = options.bind.kind === 'docker-bridge' ? options.bind.peerAddress : undefined
  const targetPort = options.targetPort
  const connections = new Set<() => void>()
  let closing = false
  const server = net.createServer({ allowHalfOpen: true }, client => {
    const allowed = allowedPeer(client.remoteAddress, peerAddress)
    // Never contact the backend or send protocol bytes for rejected peers.
    if (closing || !allowed || connections.size >= maxConnections) {
      client.on('error', () => {})
      client.destroy()
      return
    }
    const upstream = new net.Socket({ allowHalfOpen: true })
    let closedSockets = 0
    const timer = setTimeout(() => destroy(), 5000)
    timer.unref()
    function destroy() {
      clearTimeout(timer)
      client.destroy()
      upstream.destroy()
    }
    function closed(socket: net.Socket) {
      // A clean FIN in both directions may precede the other socket draining.
      // Only abort that drain when this side closed prematurely.
      if (!socket.readableEnded || !socket.writableFinished) destroy()
      if (++closedSockets === 2) {
        clearTimeout(timer)
        connections.delete(destroy)
      }
    }
    connections.add(destroy)
    client.on('error', destroy)
    upstream.on('error', destroy)
    client.once('close', () => closed(client))
    upstream.once('close', () => closed(upstream))
    upstream.once('connect', () => clearTimeout(timer))
    // pipe preserves backpressure and forwards FIN independently in each direction.
    client.pipe(upstream)
    upstream.pipe(client)
    try {
      upstream.connect({ host: '127.0.0.1', port: targetPort })
    } catch {
      destroy()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: address, port: 0, exclusive: true }, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  let closePromise: Promise<void> | undefined
  function close(): Promise<void> {
    if (!closePromise) {
      closing = true
      closePromise = new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        for (const destroy of connections) destroy()
      })
    }
    return closePromise
  }
  server.on('error', () => {
    void close().catch(() => {})
  })
  const bound = server.address() as net.AddressInfo
  return { address, port: bound.port, close }
}

/** One fresh pinned TLS identity per listener; stream is the sole backend capability.
 * expiresAt is Unix milliseconds. No idle timeout after upstream connection.
 */
export async function startSecureRemoteRelay(options: {
  bind: RemoteRelayOptions['bind']
  stream: { connect(): net.Socket | null }
  maxConnections?: number
}): Promise<
  RemoteRelay & {
    tls: { serverName: string; certificatePem: string }
    expiresAt: number
    isAlive(): boolean
  }
> {
  const address = validateBind(options.bind)
  const peerAddress = options.bind.kind === 'docker-bridge' ? options.bind.peerAddress : undefined
  const maxConnections = options.maxConnections ?? 256
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 4096) {
    throw new Error('Relay maxConnections must be an integer between 1 and 4096')
  }
  if (typeof options.stream?.connect !== 'function')
    throw new Error('Relay stream.connect required')
  const connect = options.stream.connect.bind(options.stream)
  const identity = await createRemoteRelayIdentity()
  const server = tls.createServer({
    cert: identity.certificatePem,
    key: identity.keyPem,
    handshakeTimeout: 5000,
    ALPNProtocols: ['http/1.1'],
    allowHalfOpen: true,
  })
  type Connection = {
    sockets: Set<net.Socket>
    destroy(): void
    timer: ReturnType<typeof setTimeout>
  }
  const connections = new Map<string, Connection>()
  // Both raw and TLS sockets expose the same peer tuple; no private TLS internals.
  const key = (socket: net.Socket) => `${socket.remoteAddress}:${socket.remotePort}`
  let closing = false
  let closePromise: Promise<void> | undefined
  function close(): Promise<void> {
    if (!closePromise) {
      closing = true
      closePromise = new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        for (const connection of connections.values()) connection.destroy()
      })
    }
    return closePromise
  }
  server.on('connection', (raw: net.Socket) => {
    raw.on('error', () => {})
    if (
      closing ||
      !allowedPeer(raw.remoteAddress, peerAddress) ||
      connections.size >= maxConnections
    ) {
      raw.destroy()
      return
    }
    const id = key(raw)
    const connection: Connection = {
      sockets: new Set([raw]),
      destroy() {
        clearTimeout(connection.timer)
        // Tear down TLS before its raw transport (they share the native handle).
        for (const socket of [...connection.sockets].reverse()) socket.destroy()
      },
      timer: setTimeout(() => connection.destroy(), 5000),
    }
    connection.timer.unref()
    connections.set(id, connection)
    raw.once('close', () => {
      connection.sockets.delete(raw)
      if (connection.sockets.size === 0) {
        clearTimeout(connection.timer)
        connections.delete(id)
      }
    })
  })
  server.on('secureConnection', client => {
    const id = key(client)
    const connection = connections.get(id)
    if (closing || !connection) {
      client.on('error', () => {})
      client.destroy()
      return
    }
    function own(socket: net.Socket) {
      connection!.sockets.add(socket)
      socket.on('error', connection!.destroy)
      socket.once('close', () => {
        if (!socket.readableEnded || !socket.writableFinished) connection!.destroy()
        connection!.sockets.delete(socket)
        if (connection!.sockets.size === 0) {
          clearTimeout(connection!.timer)
          connections.delete(id)
        }
      })
    }
    own(client)
    clearTimeout(connection.timer)
    connection.timer = setTimeout(() => connection.destroy(), 5000)
    connection.timer.unref()
    try {
      const upstream = connect()
      if (!upstream) {
        connection.destroy()
        return
      }
      own(upstream)
      if (upstream.connecting) upstream.once('connect', () => clearTimeout(connection.timer))
      else clearTimeout(connection.timer)
      client.pipe(upstream)
      upstream.pipe(client)
    } catch {
      connection.destroy()
    }
  })
  server.on('tlsClientError', (_error, socket) => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: address, port: 0, exclusive: true }, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  server.on('error', () => {
    void close().catch(() => {})
  })
  return {
    address,
    port: (server.address() as net.AddressInfo).port,
    close,
    tls: { serverName: identity.serverName, certificatePem: identity.certificatePem },
    expiresAt: identity.expiresAt,
    isAlive: () => !closing && server.listening,
  }
}

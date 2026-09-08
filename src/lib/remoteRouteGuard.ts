import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { createServer as createTcpServer, type Socket } from 'node:net'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createTlsServer, type TLSSocket } from 'node:tls'
import { allowedPeer, validateBind, type RemoteRelayOptions } from './remoteRelay'
import { createRemoteRelayIdentity } from './remoteRelayIdentity'
import type { RemoteRoutePlan } from './remoteRoutePlan.ts'

type Status = 'conflict' | 'unavailable'
type Candidate = { owner: { id: string; kind: 'local' | 'ssh'; label: string }; worktreeId: string }
const MAX_BODY = 1024 * 1024
const TIMEOUT = 5000
const MAX_CONNECTIONS = 128
const invalid = (): never => {
  throw new Error('Invalid remote route guard metadata')
}
const dns = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 253 &&
  value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 4096 && value.trim().length > 0

function snapshot(plan: RemoteRoutePlan, status: Status) {
  if (
    !plan ||
    !dns(plan.hostname) ||
    !Number.isInteger(plan.port) ||
    plan.port < 1 ||
    plan.port > 65535 ||
    (plan.transport !== 'http' && plan.transport !== 'tls-sni') ||
    !plan.resolution ||
    !['resolved', 'conflict', 'unavailable'].includes(plan.resolution.status) ||
    (status !== 'conflict' && status !== 'unavailable') ||
    (status === 'conflict') !== (plan.resolution.status === 'conflict')
  )
    return invalid()
  const candidates = new Map<string, Candidate>()
  if (plan.resolution.status === 'conflict') {
    const input = plan.resolution.candidates
    if (!Array.isArray(input) || input.length === 0 || input.length > 4096) return invalid()
    for (const candidate of input) {
      const owner = candidate?.owner
      if (
        !owner ||
        !text(owner.id) ||
        !text(owner.label) ||
        (owner.kind !== 'local' && owner.kind !== 'ssh') ||
        !text(candidate.worktreeId)
      )
        return invalid()
      const item: Candidate = {
        owner: { id: owner.id, kind: owner.kind, label: owner.label },
        worktreeId: candidate.worktreeId,
      }
      const key = JSON.stringify([owner.id, candidate.worktreeId])
      const previous = candidates.get(key)
      if (previous && JSON.stringify(previous) !== JSON.stringify(item)) return invalid()
      candidates.set(key, item)
    }
  }
  const ordered = [...candidates.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const body = Buffer.from(
    JSON.stringify({
      status,
      ...(status === 'conflict' ? { candidates: ordered.map(([, c]) => c) } : {}),
    })
  )
  if (body.length > MAX_BODY) return invalid()
  return { hostname: plan.hostname.toLowerCase(), port: plan.port, transport: plan.transport, body }
}

function httpResponder(config: ReturnType<typeof snapshot>, status: Status) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const hosts: string[] = []
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      if (request.rawHeaders[i]?.toLowerCase() === 'host') hosts.push(request.rawHeaders[i + 1]!)
    }
    const authority = hosts.length === 1 ? /^([^:]+)(?::([0-9]{1,5}))?$/.exec(hosts[0]!) : null
    const valid = authority && dns(authority[1])
    const matches =
      valid &&
      authority[1]!.toLowerCase() === config.hostname &&
      (authority[2] === undefined || Number(authority[2]) === config.port)
    const code = !valid ? 400 : !matches ? 421 : status === 'conflict' ? 409 : 503
    const body = matches ? config.body : Buffer.from(JSON.stringify({ status: 'misdirected' }))
    response.writeHead(code, {
      'Cache-Control': 'no-store',
      Connection: 'close',
      'Content-Type': 'application/json',
      'Content-Length': body.length,
    })
    // Never consume the request body, including POST and Expect: 100-continue.
    response.end(body)
  }
}

/**
 * UNSAFE for persistent publication. Legacy ephemeral plaintext rejection backend.
 * TLS-SNI is a raw TCP sink behind TLS-terminating Traefik.
 */
export async function startRemoteRouteGuard(
  plan: RemoteRoutePlan,
  status: Status
): Promise<{ address: '127.0.0.1'; port: number; close(): Promise<void> }> {
  const config = snapshot(plan, status)
  const respond = httpResponder(config, status)
  const server =
    config.transport === 'http'
      ? createHttpServer(
          { maxHeaderSize: 16 * 1024, headersTimeout: TIMEOUT, requestTimeout: TIMEOUT },
          respond
        )
      : createTcpServer(socket => socket.destroy())
  if (config.transport === 'http') {
    // Inspect every header within maxHeaderSize; never hide a duplicate Host by count truncation.
    if ('maxHeadersCount' in server) server.maxHeadersCount = 0
    server.on('checkContinue', respond)
    server.on('checkExpectation', respond)
  }
  const sockets = new Set<Socket>()
  server.maxConnections = MAX_CONNECTIONS
  server.on('connection', (socket: Socket) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    const timer = setTimeout(() => socket.destroy(), TIMEOUT)
    timer.unref()
    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      clearTimeout(timer)
      sockets.delete(socket)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') return invalid()
  let closing: Promise<void> | undefined
  return {
    address: '127.0.0.1',
    port: address.port,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}

/** Direct pinned TLS rejection listener; no plaintext hop or outbound capability. */
export async function startSecureRemoteRouteGuard(
  plan: RemoteRoutePlan,
  status: Status,
  bind: RemoteRelayOptions['bind'] = { kind: 'loopback' }
): Promise<{
  address: string
  port: number
  tls: { serverName: string; certificatePem: string }
  expiresAt: number
  isAlive(): boolean
  close(): Promise<void>
}> {
  const config = snapshot(plan, status)
  const address = validateBind(bind)
  const peerAddress = bind.kind === 'docker-bridge' ? bind.peerAddress : undefined
  const identity = await createRemoteRelayIdentity()
  const options = {
    cert: identity.certificatePem,
    key: identity.keyPem,
    handshakeTimeout: TIMEOUT,
    ALPNProtocols: ['http/1.1'],
  }
  const respond = httpResponder(config, status)
  const server =
    config.transport === 'http'
      ? createHttpsServer(
          {
            ...options,
            maxHeaderSize: 16 * 1024,
            headersTimeout: TIMEOUT,
            requestTimeout: TIMEOUT,
          },
          respond
        )
      : createTlsServer(options)
  if ('maxHeadersCount' in server) {
    server.maxHeadersCount = 0
    server.on('checkContinue', respond)
    server.on('checkExpectation', respond)
  }
  type Connection = { sockets: Set<Socket>; destroy(): void }
  const connections = new Map<string, Connection>()
  const key = (socket: Socket) => `${socket.remoteAddress}:${socket.remotePort}`
  let closing: Promise<void> | undefined
  function close(): Promise<void> {
    closing ??= new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
      for (const connection of connections.values()) connection.destroy()
    })
    return closing
  }
  // Prepend admission so raw peers are counted/denied before TLS processing.
  server.prependListener('connection', (raw: Socket) => {
    raw.on('error', () => {})
    if (
      closing ||
      !allowedPeer(raw.remoteAddress, peerAddress) ||
      connections.size >= MAX_CONNECTIONS
    ) {
      raw.destroy()
      return
    }
    const id = key(raw)
    let destroyed = false
    const connection: Connection = {
      sockets: new Set([raw]),
      destroy() {
        if (destroyed) return
        destroyed = true
        clearTimeout(timer)
        // Bun shares native handles: always destroy TLS before its raw transport.
        for (const socket of [...connection.sockets].reverse()) socket.destroy()
      },
    }
    const timer = setTimeout(() => connection.destroy(), TIMEOUT)
    timer.unref()
    connections.set(id, connection)
    raw.once('close', () => {
      clearTimeout(timer)
      connections.delete(id)
    })
  })
  server.on('secureConnection', (client: TLSSocket) => {
    const connection = connections.get(key(client))
    client.on('error', () => {})
    if (!connection || closing) {
      client.destroy()
      return
    }
    connection.sockets.add(client)
    client.on('error', connection.destroy)
    client.once('close', connection.destroy)
    if (config.transport === 'tls-sni') connection.destroy()
  })
  server.on('tlsClientError', (_error, socket) => {
    const connection = connections.get(key(socket))
    if (connection) {
      connection.sockets.add(socket)
      connection.destroy()
    } else socket.destroy()
  })
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
  const bound = server.address()
  if (!bound || typeof bound === 'string') return invalid()
  return {
    address,
    port: bound.port,
    tls: { serverName: identity.serverName, certificatePem: identity.certificatePem },
    expiresAt: identity.expiresAt,
    isAlive: () => !closing && server.listening,
    close,
  }
}

import * as http from 'node:http'
import * as net from 'node:net'
import type { Duplex } from 'node:stream'
import type { RouteResolution } from './routeOwnership'

type ResolvedRoute = Extract<RouteResolution, { status: 'resolved' }>
interface Target {
  address: string
  port: number
}
export interface RouteIngressOptions extends Target {
  hostname: string
  protocol: 'http' | 'tcp'
  resolve: () => RouteResolution
  backend: (route: ResolvedRoute) => Target | undefined
}

const HEADER_TIMEOUT = 5_000
const loopback = (address: string) => net.isIPv4(address) && address.startsWith('127.')
const validPort = (port: number, minimum = 1) =>
  Number.isInteger(port) && port >= minimum && port <= 65535
const hostnamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

function matchesHost(request: http.IncomingMessage, hostname: string, port: number): boolean {
  // Reject duplicate Host fields, userinfo, whitespace, paths and IPv6 authorities.
  const hosts = request.rawHeaders.filter(
    (value, index) => index % 2 === 0 && value.toLowerCase() === 'host'
  )
  if (hosts.length !== 1) return false
  const match = /^([^:]+)(?::([0-9]+))?$/.exec(request.headers.host ?? '')
  return (
    !!match &&
    match[1]?.toLowerCase() === hostname.toLowerCase() &&
    (match[2] === undefined || (validPort(Number(match[2])) && Number(match[2]) === port))
  )
}

function cleanHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = { ...headers }
  const named = String(headers.connection ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
  for (const name of [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'proxy-connection',
    ...named,
  ]) {
    delete result[name]
  }
  return result
}

type Decision = { target: Target } | { status: number; body: unknown }
function decide(options: RouteIngressOptions): Decision {
  try {
    const route = options.resolve()
    if (route.status === 'conflict') return { status: 409, body: route }
    if (route.status !== 'resolved' || route.service.protocol !== options.protocol) {
      return { status: 503, body: { status: 'unavailable' } }
    }
    const target = options.backend(route)
    if (target && loopback(target.address) && validPort(target.port))
      return { target: { ...target } }
  } catch {
    // A failed snapshot or tunnel lookup must never fall back to another owner.
  }
  return { status: 503, body: { status: 'unavailable' } }
}

/** Local ingress only. Port zero is reserved for internal test allocation. */
export async function startRouteIngress(options: RouteIngressOptions): Promise<{
  port: number
  close: () => Promise<void>
}> {
  if (
    !loopback(options.address) ||
    !validPort(options.port, 0) ||
    !hostnamePattern.test(options.hostname) ||
    options.hostname.length > 253 ||
    !['http', 'tcp'].includes(options.protocol)
  )
    throw new Error('Invalid route ingress configuration')

  const sockets = new Set<Duplex>()
  const requests = new Set<http.ClientRequest>()
  let closing = false
  let port = options.port
  const own = (socket: Duplex) => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
    if (closing) socket.destroy()
  }
  const reject = (response: http.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  const authorize = (request: http.IncomingMessage): Decision =>
    !matchesHost(request, options.hostname, port)
      ? { status: 404, body: { status: 'not-found' } }
      : decide(options)

  const proxy = (
    request: http.IncomingMessage,
    response?: http.ServerResponse,
    client?: Duplex,
    head?: Buffer
  ) => {
    const decision = authorize(request)
    const fail = (status: number, body: unknown) => {
      if (response) {
        if (response.headersSent) response.destroy()
        else reject(response, status, body)
      } else if (client && !client.destroyed) {
        const text = JSON.stringify(body)
        client.end(
          `HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
          () => client.destroy()
        )
      }
    }
    if (!('target' in decision)) {
      request.resume()
      fail(decision.status, decision.body)
      return
    }
    const headers = cleanHeaders(request.headers)
    // Host is an end-to-end routing identity, even if named in Connection.
    headers.host = request.headers.host
    if (client) {
      if (request.method !== 'GET' || request.headers.upgrade?.toLowerCase() !== 'websocket') {
        fail(503, { status: 'unavailable' })
        return
      }
      headers.connection = 'Upgrade'
      headers.upgrade = 'websocket'
    }
    const upstream = http.request({
      host: decision.target.address,
      port: decision.target.port,
      method: request.method,
      path: request.url,
      headers,
      agent: false,
    })
    requests.add(upstream)
    upstream.once('close', () => requests.delete(upstream))
    upstream.on('socket', own)
    const timer = setTimeout(
      () => upstream.destroy(new Error('Upstream headers timed out')),
      HEADER_TIMEOUT
    )
    timer.unref()
    const clear = () => clearTimeout(timer)
    upstream.once('close', clear)
    upstream.on('error', () => {
      clear()
      fail(503, { status: 'unavailable' })
    })
    request.once('aborted', () => upstream.destroy())
    const downstream = response ?? client!
    downstream.once('close', () => upstream.destroy())
    upstream.once('response', incoming => {
      clear()
      incoming.on('error', () => downstream.destroy())
      if (!response) {
        incoming.destroy()
        fail(503, { status: 'unavailable' })
        return
      }
      response.writeHead(incoming.statusCode ?? 503, cleanHeaders(incoming.headers))
      response.once('close', () => incoming.destroy())
      incoming.pipe(response)
    })
    upstream.once('upgrade', (incoming, socket, upstreamHead) => {
      clear()
      own(socket)
      if (
        !client ||
        incoming.statusCode !== 101 ||
        incoming.headers.upgrade?.toLowerCase() !== 'websocket' ||
        !String(incoming.headers.connection)
          .toLowerCase()
          .split(',')
          .some(token => token.trim() === 'upgrade')
      ) {
        socket.destroy()
        fail(503, { status: 'unavailable' })
        return
      }
      const upgradeHeaders = cleanHeaders(incoming.headers)
      upgradeHeaders.connection = 'Upgrade'
      upgradeHeaders.upgrade = 'websocket'
      let handshake = 'HTTP/1.1 101 Switching Protocols\r\n'
      for (const [name, value] of Object.entries(upgradeHeaders)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item !== undefined) handshake += `${name}: ${item}\r\n`
        }
      }
      client.write(handshake + '\r\n')
      if (upstreamHead.length) client.write(upstreamHead)
      if (head?.length) socket.write(head)
      client.once('close', () => socket.destroy())
      socket.once('close', () => client.destroy())
      socket.pipe(client).pipe(socket)
    })
    if (client) upstream.end()
    else request.pipe(upstream)
  }

  const server =
    options.protocol === 'http'
      ? http.createServer((request, response) => proxy(request, response))
      : net.createServer(client => {
          const decision = decide(options)
          if (!('target' in decision) || closing) {
            client.destroy()
            return
          }
          const upstream = net.connect(decision.target.port, decision.target.address)
          own(upstream)
          const timer = setTimeout(() => upstream.destroy(), HEADER_TIMEOUT)
          timer.unref()
          upstream.once('connect', () => clearTimeout(timer))
          upstream.once('close', () => {
            clearTimeout(timer)
            client.destroy()
          })
          client.once('close', () => upstream.destroy())
          client.pipe(upstream).pipe(client)
        })
  server.on('connection', own)
  if (server instanceof http.Server) {
    server.headersTimeout = HEADER_TIMEOUT
    server.requestTimeout = 0 // Streaming bodies are not subject to the headers deadline.
    server.on('upgrade', (request, socket, head) => proxy(request, undefined, socket, head))
    server.on('clientError', (_, socket) => socket.destroy())
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.address, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  port = (server.address() as net.AddressInfo).port
  let closePromise: Promise<void> | undefined
  return {
    port,
    close: () =>
      (closePromise ??= new Promise<void>((resolve, reject) => {
        closing = true
        server.close(error => (error ? reject(error) : resolve()))
        for (const request of requests) request.destroy()
        for (const socket of sockets) socket.destroy()
      })),
  }
}

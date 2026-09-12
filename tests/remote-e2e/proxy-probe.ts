// Explicit HTTP component wiring; not automatic route publication or `port up`.
import { execFileSync } from 'node:child_process'
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, isIP, type Socket } from 'node:net'
import { createServer as createTLSServer } from 'node:tls'
import { createRemoteRelayIdentity } from '../../src/lib/remote/routing/relayIdentity.ts'
import { openRemoteStream } from '../../src/lib/remote/session/session.ts'
import { startSecureRemoteRelay } from '../../src/lib/remote/routing/relay.ts'
import { parseRemoteSnapshot } from '../../src/lib/remote/session/snapshot.ts'
import { compileRemoteRoutePlan } from '../../src/lib/remote/routing/plan.ts'
import { renderRemoteRouteConfig } from '../../src/lib/remote/routing/config.ts'
import { startSecureRemoteRouteGuard } from '../../src/lib/remote/routing/guard.ts'

const container = 'port-http-component-traefik'
const network = 'traefik-network'
let deadline = Date.now() + 45_000
let interrupted = false
const interrupt = () => {
  interrupted = true
}
function docker(args: string[], cleanup = false): string {
  if (!cleanup && (interrupted || Date.now() >= deadline)) throw new Error('setup interrupted')
  return execFileSync('/usr/local/bin/docker', ['--host', 'tcp://127.0.0.1:2375', ...args], {
    encoding: 'utf8',
    timeout: cleanup ? 5000 : Math.max(1, Math.min(10_000, deadline - Date.now())),
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
function privateIP(value: string): string {
  const [a, b] = value.split('.').map(Number)
  if (
    isIP(value) !== 4 ||
    !(a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168))
  ) {
    throw new Error('invalid fixture network')
  }
  return value
}
function cachedTarget(directory: string) {
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o700)
    throw new Error('invalid session')
  const fd = openSync(`${directory}/snapshot.json`, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const file = fstatSync(fd)
    if (
      !file.isFile() ||
      file.uid !== process.getuid!() ||
      (file.mode & 0o777) !== 0o600 ||
      file.size > 4 * 1024 * 1024 + 1024
    )
      throw new Error('invalid cache')
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1025)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    if (length === buffer.length) throw new Error('cache too large')
    const cache = JSON.parse(buffer.subarray(0, length).toString('utf8'))
    if (cache.version !== 1 || cache.kind !== 'port-session-snapshot' || cache.status !== 'ready')
      throw new Error('cache unavailable')
    const snapshot = parseRemoteSnapshot(JSON.stringify(cache.snapshot))
    const trees = snapshot.worktrees.filter(tree => tree.namespace === 'feature.port')
    const endpoints = trees.flatMap(tree =>
      tree.endpoints.filter(item => item.name === 'ui' && item.logicalPort === 3000)
    )
    if (trees.length !== 1 || endpoints.length !== 1) throw new Error('missing unique endpoint')
    return { snapshot, worktreeId: trees[0]!.worktreeId, endpoint: endpoints[0]! }
  } finally {
    closeSync(fd)
  }
}
function waitCommand(expected: string): Promise<void> {
  if (interrupted) return Promise.reject(new Error('probe interrupted'))
  return new Promise((resolve, reject) => {
    let command = ''
    const timer = setTimeout(() => finish(false), 30_000)
    function finish(valid: boolean) {
      clearTimeout(timer)
      process.stdin.off('data', data)
      process.stdin.off('end', end)
      process.stdin.off('error', end)
      process.off('SIGTERM', end)
      process.off('SIGINT', end)
      process.stdin.pause()
      if (valid) resolve()
      else reject(new Error('invalid close'))
    }
    function data(chunk: Buffer) {
      if (chunk.length > expected.length - command.length) return finish(false)
      command += chunk.toString('utf8')
      if (!expected.startsWith(command)) return finish(false)
      if (command === expected) finish(true)
    }
    function end() {
      finish(false)
    }
    process.stdin.on('data', data)
    process.stdin.resume()
    process.stdin.once('end', end)
    process.stdin.once('error', end)
    process.once('SIGTERM', end)
    process.once('SIGINT', end)
  })
}
// Crash simulation only: replace the listener without touching YAML, Traefik or SSH.
async function collector(address: string, port: number, wrongTLS: boolean) {
  const identity = wrongTLS ? await createRemoteRelayIdentity() : undefined
  const server = identity
    ? createTLSServer({
        cert: identity.certificatePem,
        key: identity.keyPem,
        handshakeTimeout: 1500,
      })
    : createServer()
  const sockets = new Set<Socket>()
  let connections = 0
  let applicationHits = 0
  let sentinelHits = 0
  function own(socket: Socket) {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.setTimeout(1500, () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
  }
  function capture(socket: Socket, plaintext: boolean) {
    socket.once('data', (chunk: Buffer) => {
      // Inspect only a bounded prefix; never retain or print network bytes.
      const prefix = chunk.subarray(0, 4096)
      if (!plaintext || prefix[0] !== 22) applicationHits++
      if (prefix.includes('port-stale-sentinel') || prefix.includes('/cgi-bin/sentinel'))
        sentinelHits++
      socket.destroy()
    })
  }
  server.on('connection', (socket: Socket) => {
    connections++
    own(socket)
    if (connections > 128) socket.destroy()
    else if (!wrongTLS) capture(socket, true)
  })
  if (wrongTLS) {
    server.on('secureConnection', (socket: Socket) => {
      own(socket)
      capture(socket, false)
    })
    server.on('tlsClientError', (_error, socket: Socket) => socket.destroy())
  }
  let closePromise: Promise<void> | undefined
  function close() {
    if (!closePromise) {
      clearTimeout(lifetime)
      // TLS wrappers before their raw transports; stop all sockets before close.
      for (const socket of [...sockets].reverse()) socket.destroy()
      closePromise = new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
    }
    return closePromise
  }
  const lifetime = setTimeout(() => void close().catch(() => {}), 30_000)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: address, port, exclusive: true }, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  } catch (error) {
    clearTimeout(lifetime)
    throw error
  }
  server.on('error', () => void close().catch(() => {}))
  return { close, stats: () => ({ connections, applicationHits, sentinelHits }) }
}
async function closeGuards(guards: Iterable<{ close(): Promise<void> }>) {
  const results = await Promise.allSettled([...guards].map(guard => guard.close()))
  if (results.some(result => result.status === 'rejected')) throw new Error('guard cleanup failed')
}
async function main() {
  if (process.argv.length !== 3) throw new Error('invalid arguments')
  const target = cachedTarget(process.argv[2]!)
  const temporary = mkdtempSync('/root/port-http-component-')
  process.on('SIGTERM', interrupt)
  process.on('SIGINT', interrupt)
  const watchdog = setTimeout(() => process.kill(process.pid, 'SIGTERM'), 140_000)
  const guards = new Map<
    ReturnType<typeof compileRemoteRoutePlan>[number],
    Awaited<ReturnType<typeof startSecureRemoteRouteGuard>>
  >()
  let replacement: Awaited<ReturnType<typeof collector>> | undefined
  let owned = false
  let forward: Awaited<ReturnType<typeof openRemoteStream>> = null
  let relay: Awaited<ReturnType<typeof startSecureRemoteRelay>> | undefined
  try {
    if (!docker(['network', 'ls', '--format', '{{.Name}}']).split('\n').includes(network))
      docker(['network', 'create', network])
    if (docker(['network', 'inspect', '--format', '{{.Driver}}', network]) !== 'bridge')
      throw new Error('not bridge')
    const gateway = privateIP(
      docker(['network', 'inspect', '--format', '{{(index .IPAM.Config 0).Gateway}}', network])
    )
    // Create fails if the fixed fixture name exists; never delete an unowned container.
    const id = docker([
      'create',
      '--pull=never',
      '--name',
      container,
      '--network',
      network,
      '-p',
      '127.0.0.1:80:80',
      '-p',
      '127.0.0.1:3000:3000',
      '--entrypoint',
      '/bin/sh',
      'traefik:v3.6',
      '-c',
      'while [ ! -f /tmp/port-http-start ]; do sleep 0.1; done; exec traefik --entrypoints.web.address=:80 --entrypoints.port3000.address=:3000 --providers.file.filename=/tmp/routes.yml',
    ])
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid container identity')
    owned = true
    docker(['start', container])
    const peerAddress = privateIP(
      docker([
        'inspect',
        '--format',
        '{{(index .NetworkSettings.Networks "traefik-network").IPAddress}}',
        container,
      ])
    )
    forward = await openRemoteStream(process.argv[2]!, target.endpoint.target)
    if (!forward || interrupted || Date.now() >= deadline) throw new Error('forward unavailable')
    relay = await startSecureRemoteRelay({
      stream: forward,
      bind: { kind: 'docker-bridge', address: gateway, peerAddress },
    })
    const owner = { id: 'fixture-remote-a', kind: 'ssh' as const, label: 'remote-a' }
    const plans = compileRemoteRoutePlan([{ owner, alias: 'remote-a', snapshot: target.snapshot }])
    const readyTarget = { address: gateway, port: relay.port, tls: relay.tls }
    const routes = renderRemoteRouteConfig(plans, {
      backend: ref => {
        if (
          ref.ownerId !== owner.id ||
          ref.worktreeId !== target.worktreeId ||
          ref.endpointId !== target.endpoint.id
        )
          throw new Error('Unexpected endpoint reference')
        return readyTarget
      },
      guard: () => {
        throw new Error('Unexpected guard in unique-owner component')
      },
    })
    if (routes.ports.length !== 1 || routes.ports[0] !== 3000)
      throw new Error('Unexpected entrypoints')
    writeFileSync(`${temporary}/routes.yml`, routes.content, { mode: 0o600, flag: 'wx' })
    docker(['cp', `${temporary}/routes.yml`, `${container}:/tmp/routes.yml`])
    docker(['exec', container, 'touch', '/tmp/port-http-start'])
    if (Date.now() >= deadline) throw new Error('setup deadline exceeded')
    console.log(JSON.stringify({ status: 'ready', address: relay.address, port: relay.port }))
    await waitCommand('plaintext\n')
    await relay.close()
    replacement = await collector(gateway, readyTarget.port, false)
    console.log(JSON.stringify({ status: 'plaintext', address: gateway, port: readyTarget.port }))
    await waitCommand('plaintext-stats\n')
    await replacement.close()
    console.log(JSON.stringify({ status: 'plaintext-stats', ...replacement.stats() }))
    await waitCommand('wrong-tls\n')
    replacement = await collector(gateway, readyTarget.port, true)
    console.log(JSON.stringify({ status: 'wrong-tls', address: gateway, port: readyTarget.port }))
    await waitCommand('wrong-tls-stats\n')
    await replacement.close()
    console.log(JSON.stringify({ status: 'wrong-tls-stats', ...replacement.stats() }))
    await waitCommand('guards\n')
    deadline = Date.now() + 20_000
    // Keep the healthy single-owner plans; only backend readiness is withdrawn.
    for (const plan of plans) {
      if (interrupted || Date.now() >= deadline) throw new Error('guard setup interrupted')
      guards.set(
        plan,
        await startSecureRemoteRouteGuard(plan, 'unavailable', {
          kind: 'docker-bridge',
          address: gateway,
          peerAddress,
        })
      )
    }
    const unavailable = renderRemoteRouteConfig(plans, {
      backend: () => undefined,
      guard: (plan, status) => {
        const guard = guards.get(plan)
        if (!guard || status !== 'unavailable') throw new Error('Unexpected guard lookup')
        return { address: guard.address, port: guard.port, tls: guard.tls }
      },
    })
    writeFileSync(`${temporary}/guards.yml`, unavailable.content, { mode: 0o600, flag: 'wx' })
    docker(['cp', `${temporary}/guards.yml`, `${container}:/tmp/routes-next.yml`])
    docker(['exec', container, 'mv', '/tmp/routes-next.yml', '/tmp/routes.yml'])
    console.log(JSON.stringify({ status: 'guards' }))
    await waitCommand('close\n')
  } finally {
    try {
      try {
        await replacement?.close()
      } finally {
        try {
          await closeGuards(guards.values())
        } finally {
          if (owned) docker(['rm', '-f', container], true)
        }
      }
    } finally {
      try {
        await relay?.close()
      } finally {
        try {
          await forward?.close()
        } finally {
          clearTimeout(watchdog)
          process.off('SIGTERM', interrupt)
          process.off('SIGINT', interrupt)
          rmSync(temporary, { recursive: true, force: true })
        }
      }
    }
  }
  console.log(JSON.stringify({ status: 'closed' }))
}
main().catch(() => {
  // No transport/auth details, session paths, or daemon diagnostics.
  console.error('HTTP component probe failed')
  process.exitCode = 1
})

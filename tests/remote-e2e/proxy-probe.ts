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
import { isIP } from 'node:net'
import { openRemoteForward } from '../../src/lib/remoteSession.ts'
import { startRemoteRelay } from '../../src/lib/remoteRelay.ts'
import { parseRemoteSnapshot } from '../../src/lib/remoteSnapshot.ts'

const container = 'port-http-component-traefik'
const network = 'traefik-network'
const deadline = Date.now() + 45_000
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
    return endpoints[0]!.target
  } finally {
    closeSync(fd)
  }
}
function waitClose(): Promise<void> {
  return new Promise((resolve, reject) => {
    let command = ''
    const timer = setTimeout(() => finish(false), 20_000)
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
      if (chunk.length > 6 - command.length) return finish(false)
      command += chunk.toString('utf8')
      if (!'close\n'.startsWith(command)) return finish(false)
      if (command === 'close\n') finish(true)
    }
    function end() {
      finish(false)
    }
    process.stdin.on('data', data)
    process.stdin.once('end', end)
    process.stdin.once('error', end)
    process.once('SIGTERM', end)
    process.once('SIGINT', end)
  })
}
async function main() {
  if (process.argv.length !== 3) throw new Error('invalid arguments')
  const target = cachedTarget(process.argv[2]!)
  const temporary = mkdtempSync('/root/port-http-component-')
  process.on('SIGTERM', interrupt)
  process.on('SIGINT', interrupt)
  let owned = false
  let forward: Awaited<ReturnType<typeof openRemoteForward>> = null
  let relay: Awaited<ReturnType<typeof startRemoteRelay>> | undefined
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
      'while [ ! -f /tmp/port-http-start ]; do sleep 0.1; done; exec traefik --entrypoints.web.address=:80 --entrypoints.logical.address=:3000 --providers.file.filename=/tmp/routes.yml',
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
    forward = await openRemoteForward(process.argv[2]!, target)
    if (!forward || interrupted || Date.now() >= deadline) throw new Error('forward unavailable')
    relay = await startRemoteRelay({
      targetPort: forward.port,
      bind: { kind: 'docker-bridge', address: gateway, peerAddress },
    })
    const routes = {
      http: {
        routers: {
          alias: {
            entryPoints: ['web'],
            rule: 'Host(`ui.feature.port`) || Host(`ui.feature.remote-a.ssh`)',
            service: 'remote',
          },
          logical: {
            entryPoints: ['logical'],
            rule: 'Host(`feature.port`) || Host(`feature.remote-a.ssh`)',
            service: 'remote',
          },
        },
        services: {
          remote: {
            loadBalancer: {
              passHostHeader: true,
              servers: [{ url: `http://${gateway}:${relay.port}` }],
            },
          },
        },
      },
    }
    // JSON is valid YAML, but Traefik selects its decoder by the supported extension.
    writeFileSync(`${temporary}/routes.yml`, JSON.stringify(routes), { mode: 0o600, flag: 'wx' })
    docker(['cp', `${temporary}/routes.yml`, `${container}:/tmp/routes.yml`])
    docker(['exec', container, 'touch', '/tmp/port-http-start'])
    if (Date.now() >= deadline) throw new Error('setup deadline exceeded')
    console.log(JSON.stringify({ status: 'ready', address: relay.address, port: relay.port }))
    await waitClose()
  } finally {
    try {
      if (owned) {
        try {
          console.error(docker(['logs', '--tail', '12', container], true))
        } catch {
          /* Fixture-only diagnostics. */
        }
        docker(['rm', '-f', container], true)
      }
    } finally {
      try {
        await relay?.close()
      } finally {
        try {
          await forward?.close()
        } finally {
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { get } from 'node:https'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { startRemoteRuntime } from './remoteRuntime.ts'
import { requestRemoteCoordinator } from './remoteCoordinatorControl.ts'
import type { RemoteSnapshot } from './remoteSnapshot.ts'

let root: string
let dynamicDirectory: string
let backend: Server
let runtime: Awaited<ReturnType<typeof startRemoteRuntime>>
let broken: boolean
let snapshot: RemoteSnapshot
beforeEach(async () => {
  root = await realpath(await mkdtemp('/tmp/port-runtime-'))
  dynamicDirectory = join(root, 'dynamic')
  await mkdir(dynamicDirectory, { mode: 0o700 })
  backend = createServer((_req, res) => res.end('correct-owner'))
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve))
  const address = backend.address()
  if (!address || typeof address === 'string') throw new Error('missing listener')
  snapshot = {
    version: 1,
    kind: 'port-service-snapshot',
    instanceId: 'local',
    revision: 0,
    worktrees: [
      {
        worktreeId: 'a'.repeat(64),
        namespace: 'feature.port',
        endpoints: [
          {
            id: 'b'.repeat(64),
            name: 'ui',
            logicalPort: 3000,
            transports: ['http'],
            aliasTransports: ['http'],
            target: { address: '127.0.0.1', port: address.port },
          },
        ],
      },
    ],
  }
  broken = false
})
afterEach(async () => {
  await runtime?.close()
  await new Promise<void>(resolve => backend.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})
async function start() {
  runtime = await startRemoteRuntime({
    root,
    dynamicDirectory,
    controlRoot: join(root, 'control'),
    collectLocal: async revision => {
      if (broken) throw new Error('unavailable')
      return { ...snapshot, revision }
    },
    prepareProxy: async () => ({
      id: 'test-proxy',
      bind: { kind: 'loopback' },
      targetAddress: '127.0.0.1',
    }),
  })
  if (!runtime) throw new Error('runtime missing')
}
async function response() {
  const config = parse(await readFile(join(dynamicDirectory, 'port-remote-routes.yml'), 'utf8'))
  const key = Object.keys(config.http.routers).find(
    key => config.http.routers[key].rule === 'Host(`ui.feature.port`)'
  )!
  const service = config.http.services[config.http.routers[key].service].loadBalancer
  const transport = config.http.serversTransports[service.serversTransport]
  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = get(
      service.servers[0].url,
      {
        ca: transport.rootCAs,
        servername: transport.serverName,
        agent: false,
        headers: { Host: 'ui.feature.port' },
      },
      res => {
        let body = ''
        res.on('data', chunk => {
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode!, body }))
      }
    )
    request.on('error', reject)
    request.setTimeout(2000, () => request.destroy(new Error('request timeout')))
  })
}
async function wake() {
  await requestRemoteCoordinator(join(root, 'control'), {
    version: 1,
    action: 'wake',
    incarnation: runtime!.incarnation,
  })
}

describe('connected coordinator runtime', () => {
  it('collects, publishes pinned routes, and guards retained local claims after restart', async () => {
    await start()
    await vi.waitFor(
      async () => expect(await response()).toEqual({ status: 200, body: 'correct-owner' }),
      { timeout: 8000 }
    )
    await runtime!.close()
    broken = true
    await start()
    await vi.waitFor(async () => expect((await response()).status).toBe(503), { timeout: 8000 })
    broken = false
    await wake()
    await vi.waitFor(async () => expect((await response()).status).toBe(200), { timeout: 8000 })
  }, 25000)
})

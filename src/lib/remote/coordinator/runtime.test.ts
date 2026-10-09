import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { get } from 'node:https'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { startRemoteObservationRuntime, startRemoteRuntime } from './runtime.ts'
import { requestRemoteCoordinator } from './control.ts'
import type { RemoteSnapshot } from '../session/snapshot.ts'

let root: string
let dynamicDirectory: string
let backend: Server
let runtime: Awaited<ReturnType<typeof startRemoteRuntime>>
let broken: boolean
let snapshot: RemoteSnapshot
type ObserveSession = NonNullable<Parameters<typeof startRemoteRuntime>[0]['observeSession']>
let observeSession: ObserveSession | undefined
let cleanupSession: ((directory: string) => Promise<void>) | undefined
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
  observeSession = undefined
  cleanupSession = undefined
})
afterEach(async () => {
  await runtime?.close()
  await new Promise<void>(resolve => backend.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})
async function start(validateSession: (directory: string) => boolean = () => true) {
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
    observeSession,
    cleanupSession,
    validateSession,
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
    const checkpoint = JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8'))
    expect(checkpoint.routes.version).toBe(1)
    expect(checkpoint.routes.routes).toContainEqual(
      expect.objectContaining({ hostname: 'ui.feature.port', availability: 'ready' })
    )
    expect(JSON.stringify(checkpoint.routes)).not.toContain('127.0.0.1')
    await runtime!.close()
    broken = true
    await start()
    await vi.waitFor(async () => expect((await response()).status).toBe(503), { timeout: 8000 })
    broken = false
    await wake()
    await vi.waitFor(async () => expect((await response()).status).toBe(200), { timeout: 8000 })
  }, 25000)

  it('keeps coordinating when local snapshots contain only custom domains', async () => {
    snapshot = {
      ...snapshot,
      worktrees: snapshot.worktrees.map(worktree => ({
        ...worktree,
        namespace: 'feature.custom',
      })),
    }
    await start()

    await vi.waitFor(async () => {
      const result = await requestRemoteCoordinator(join(root, 'control'), {
        version: 1,
        action: 'ping',
      })
      expect(result?.status).toBe('ok')
    })
    await expect(
      readFile(join(dynamicDirectory, 'port-remote-routes.yml'), 'utf8')
    ).rejects.toThrow()
  }, 10000)

  it('rejects lexically valid sessions that fail private live-state validation', async () => {
    observeSession = vi.fn()
    await start(() => false)
    const result = await requestRemoteCoordinator(join(root, 'control'), {
      version: 1,
      action: 'observe',
      incarnation: runtime!.incarnation,
      directory: '/tmp/port-ssh-Ab1234',
    })
    expect(result?.status).toBe('error')
    expect(observeSession).not.toHaveBeenCalled()
  })

  it('hosts observation tasks without starting route reconciliation', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    let taskSignal: AbortSignal | undefined
    const observationRuntime = await startRemoteObservationRuntime({
      controlRoot: join(root, 'observation-control'),
      validateSession: () => true,
      observeSession: vi.fn(async (_directory, signal) => {
        taskSignal = signal
        await held
      }),
    })
    if (!observationRuntime) throw new Error('observation runtime missing')
    const result = await requestRemoteCoordinator(join(root, 'observation-control'), {
      version: 1,
      action: 'observe',
      incarnation: observationRuntime.incarnation,
      directory: '/tmp/port-ssh-Ab1234',
    })
    expect(result?.status).toBe('ok')
    await vi.waitFor(() => expect(taskSignal).toBeDefined())
    await expect(readFile(join(root, 'checkpoint.json'), 'utf8')).rejects.toThrow()

    let closed = false
    const closing = observationRuntime.close().then(() => {
      closed = true
    })
    await vi.waitFor(() => expect(taskSignal?.aborted).toBe(true))
    expect(closed).toBe(false)
    release()
    await closing
    expect(closed).toBe(true)
  })

  it('cleans managed state after natural observation settlement', async () => {
    observeSession = vi.fn().mockResolvedValue(undefined)
    cleanupSession = vi.fn().mockResolvedValue(undefined)
    await start()
    const directory = `/tmp/port-ssh-${'a'.repeat(40)}`
    const result = await requestRemoteCoordinator(join(root, 'control'), {
      version: 1,
      action: 'observe',
      incarnation: runtime!.incarnation,
      directory,
    })
    expect(result?.status).toBe('ok')
    await vi.waitFor(() => expect(cleanupSession).toHaveBeenCalledExactlyOnceWith(directory))
  })
  it('owns deduplicated observations beyond the admitting control request', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    let taskSignal: AbortSignal | undefined
    observeSession = vi.fn(async (_directory, signal) => {
      taskSignal = signal
      await held
    })
    await start()
    const directory = '/tmp/port-ssh-Ab1234'
    const observe = () =>
      requestRemoteCoordinator(join(root, 'control'), {
        version: 1,
        action: 'observe',
        incarnation: runtime!.incarnation,
        directory,
      })

    expect((await observe())?.status).toBe('ok')
    await vi.waitFor(() => expect(taskSignal).toBeDefined())
    expect(taskSignal?.aborted).toBe(false)
    expect((await observe())?.status).toBe('ok')
    expect(observeSession).toHaveBeenCalledTimes(1)

    let stopped = false
    const unobserve = requestRemoteCoordinator(join(root, 'control'), {
      version: 1,
      action: 'unobserve',
      incarnation: runtime!.incarnation,
      directory,
    }).then(result => {
      stopped = true
      return result
    })
    await vi.waitFor(() => expect(taskSignal?.aborted).toBe(true))
    expect(stopped).toBe(false)
    release()
    expect((await unobserve)?.status).toBe('ok')
    expect(stopped).toBe(true)
  })

  it('aborts and drains observations before runtime close resolves', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    let taskSignal: AbortSignal | undefined
    observeSession = vi.fn(async (_directory, signal) => {
      taskSignal = signal
      await held
    })
    await start()
    expect(
      (
        await requestRemoteCoordinator(join(root, 'control'), {
          version: 1,
          action: 'observe',
          incarnation: runtime!.incarnation,
          directory: '/tmp/port-ssh-Ab1234',
        })
      )?.status
    ).toBe('ok')
    await vi.waitFor(() => expect(taskSignal).toBeDefined())

    let closed = false
    const closing = runtime!.close().then(() => {
      closed = true
    })
    await vi.waitFor(() => expect(taskSignal?.aborted).toBe(true))
    expect(closed).toBe(false)
    expect(
      (
        await requestRemoteCoordinator(join(root, 'control'), {
          version: 1,
          action: 'ping',
        })
      )?.status
    ).toBe('ok')
    release()
    await closing
    expect(closed).toBe(true)
  })
})

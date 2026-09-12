import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createRemoteRelayIdentity } from './relayIdentity.ts'
import {
  createRemoteRouteReconciler,
  type RemoteReconcilerSource,
  type RemoteRouteLease,
  type RemoteRouteReconcilerDependencies,
} from './reconciler.ts'

let tls: RemoteRouteLease['tls']
beforeAll(async () => {
  const identity = await createRemoteRelayIdentity()
  tls = { serverName: identity.serverName, certificatePem: identity.certificatePem }
})
const source = (id = 'remote'): RemoteReconcilerSource => ({
  owner: { id, label: id, kind: id === 'local' ? 'local' : 'ssh' },
  ...(id === 'local' ? {} : { alias: id, selectedSessionId: 'session-1' }),
  available: true,
  snapshot: {
    version: 1,
    kind: 'port-service-snapshot',
    instanceId: 'instance',
    revision: 1,
    worktrees: [
      {
        worktreeId: 'original-tree',
        namespace: 'feature.port',
        endpoints: [
          {
            id: 'endpoint',
            name: 'ui',
            aliasTransports: ['http'],
            logicalPort: 3000,
            transports: ['http', 'tls-sni'],
            target: { address: '127.0.0.1', port: 4000 },
          },
        ],
      },
    ],
  },
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}
function harness() {
  let clock = Date.now()
  const leases: RemoteRouteLease[] = []
  let published = ''
  const lease = () => {
    const result = {
      address: '127.0.0.1',
      port: 41000 + leases.length,
      tls: { ...tls },
      expiresAt: clock + 120_000,
      alive: true,
      isAlive() {
        return this.alive
      },
      close: vi.fn(async () => {
        result.alive = false
      }),
    }
    leases.push(result)
    return result
  }
  const deps = {
    now: () => clock,
    prepareProxy: vi.fn<RemoteRouteReconcilerDependencies['prepareProxy']>(async () => ({
      id: 'proxy-1',
      targetAddress: '127.0.0.1',
      bind: { kind: 'loopback' },
    })),
    createBackend: vi.fn<RemoteRouteReconcilerDependencies['createBackend']>(async () => lease()),
    createGuard: vi.fn<RemoteRouteReconcilerDependencies['createGuard']>(async () => lease()),
    publish: vi.fn(async (content: string) => {
      published = content
    }),
  }
  return {
    deps,
    lease,
    leases,
    reconciler: createRemoteRouteReconciler(deps),
    advance: (ms: number) => {
      clock += ms
    },
    published: () => published,
  }
}

describe('remote route reconciler', () => {
  it('invalidates reuse when only the proxy target address changes', async () => {
    const h = harness()
    await h.reconciler.reconcile([source()])
    h.deps.prepareProxy.mockResolvedValue({
      id: 'proxy-1',
      bind: { kind: 'loopback' },
      targetAddress: 'host.docker.internal',
    })
    await h.reconciler.reconcile([source()])
    expect(h.deps.createBackend).toHaveBeenCalledTimes(2)
    expect(h.leases[0]!.close).toHaveBeenCalledTimes(1)
    await h.reconciler.close()
  })
  it('replaces an unexpired dead lease using the captured bound capability', async () => {
    const h = harness()
    const first = h.lease()
    h.deps.createBackend.mockResolvedValueOnce(first)
    await h.reconciler.reconcile([source()])
    first.isAlive = () => false
    await h.reconciler.reconcile([source()])
    expect(h.deps.createBackend).toHaveBeenCalledTimes(1)
    first.alive = false
    first.isAlive = () => true
    await h.reconciler.reconcile([source()])
    expect(h.deps.createBackend).toHaveBeenCalledTimes(2)
    expect(first.close).toHaveBeenCalledTimes(1)
    await h.reconciler.close()
  })

  it('reports only staged backends when publishing a guarded route', async () => {
    const h = harness()
    h.deps.createBackend.mockResolvedValueOnce(null)
    const result = await h.reconciler.reconcile([source()])
    expect(result.readyBackends).toEqual([])
    expect(h.deps.publish).toHaveBeenLastCalledWith(expect.any(String), [])
    await h.reconciler.close()
  })

  it.each(['false', 'throw'])('guards a new backend whose liveness returns %s', async mode => {
    const h = harness()
    h.deps.createBackend.mockImplementationOnce(async () => {
      const result = h.lease()
      result.isAlive = () => {
        if (mode === 'throw') throw new Error('dead')
        return false
      }
      return result
    })
    await h.reconciler.reconcile([source()])
    expect(h.deps.createGuard).toHaveBeenCalled()
    expect(h.leases[0]!.close).toHaveBeenCalledTimes(1)
    await h.reconciler.close()
  })

  it.each(['false', 'throw'])('fails closed when guard liveness returns %s', async mode => {
    const h = harness()
    await h.reconciler.reconcile([source()])
    const old = h.published()
    h.deps.createGuard.mockImplementationOnce(async () => {
      const result = h.lease()
      result.isAlive = () => {
        if (mode === 'throw') throw new Error('dead')
        return false
      }
      return result
    })
    await expect(h.reconciler.reconcile([source(), source('local')])).rejects.toThrow()
    expect(h.published()).toBe(old)
    expect(h.leases.every(lease => vi.mocked(lease.close).mock.calls.length === 1)).toBe(true)
    await h.reconciler.close()
  })

  it('compiles all ownership before allocation and requires available SSH sessions', async () => {
    const h = harness()
    await expect(h.reconciler.reconcile([source(), source()])).rejects.toThrow()
    const missing = source()
    delete missing.selectedSessionId
    await expect(h.reconciler.reconcile([missing])).rejects.toThrow('selected session')
    expect(h.deps.prepareProxy).not.toHaveBeenCalled()
    expect(h.deps.createBackend).not.toHaveBeenCalled()
    await h.reconciler.reconcile([source('local')])
    expect(h.deps.prepareProxy).toHaveBeenCalledWith([3000])
    await h.reconciler.close()
  })

  it('never dials retained unavailable claim IDs, while preserving their guards', async () => {
    const h = harness()
    const claim = source()
    claim.available = false
    delete claim.selectedSessionId
    claim.snapshot.worktrees[0]!.worktreeId = 'claim-tree'
    await h.reconciler.reconcile([claim])
    expect(h.deps.createBackend).not.toHaveBeenCalled()
    expect(h.deps.createGuard.mock.calls.every(([args]) => args.status === 'unavailable')).toBe(
      true
    )
    const count = h.deps.createGuard.mock.calls.length
    await h.reconciler.reconcile([claim])
    expect(h.deps.createGuard).toHaveBeenCalledTimes(count)
    await h.reconciler.close()
  })

  it('shares HTTP/TLS/named leases and keeps explicit backends alive across default conflicts', async () => {
    const h = harness()
    await h.reconciler.reconcile([source()])
    const first = h.leases[0]!
    expect(h.deps.createBackend).toHaveBeenCalledTimes(1)
    await h.reconciler.reconcile([source(), source('local')])
    expect(h.deps.createBackend).toHaveBeenCalledTimes(2)
    expect(first.close).not.toHaveBeenCalled()
    expect(h.deps.createGuard.mock.calls.some(([a]) => a.status === 'conflict')).toBe(true)
    const guards = h.deps.createGuard.mock.calls.length
    await h.reconciler.reconcile([source(), source('local')])
    expect(h.deps.createGuard).toHaveBeenCalledTimes(guards)
    await h.reconciler.reconcile([source(), source('local'), source('third')])
    expect(h.deps.createGuard.mock.calls.length).toBeGreaterThan(guards)
    expect(first.close).not.toHaveBeenCalled()
    await h.reconciler.reconcile([source()])
    expect(first.close).not.toHaveBeenCalled()
    await h.reconciler.close()
    expect(h.leases.every(lease => vi.mocked(lease.close).mock.calls.length === 1)).toBe(true)
  })

  it.each(['target', 'session', 'proxy', 'bind', 'expiry'])(
    'rotates for %s changes after publishing',
    async change => {
      const h = harness()
      const input = source()
      await h.reconciler.reconcile([input])
      const first = h.leases[0]!
      if (change === 'target') input.snapshot.worktrees[0]!.endpoints[0]!.target.port++
      if (change === 'session') input.selectedSessionId = 'session-2'
      if (change === 'proxy')
        h.deps.prepareProxy.mockResolvedValue({
          id: 'proxy-2',
          targetAddress: '127.0.0.1',
          bind: { kind: 'loopback' },
        })
      if (change === 'bind')
        h.deps.prepareProxy.mockResolvedValue({
          id: 'proxy-1',
          targetAddress: '172.20.0.1',
          bind: { kind: 'docker-bridge', address: '172.20.0.1', peerAddress: '172.20.0.2' },
        })
      if (change === 'expiry') h.advance(60_000)
      h.deps.publish.mockImplementationOnce(async () => {
        expect(first.close).not.toHaveBeenCalled()
      })
      await h.reconciler.reconcile([input])
      expect(h.deps.createBackend).toHaveBeenCalledTimes(2)
      expect(first.close).toHaveBeenCalledTimes(1)
      await h.reconciler.close()
    }
  )

  it.each(['null', 'throw', 'expired'])(
    'uses unavailable guards for %s backend allocation',
    async mode => {
      const h = harness()
      h.deps.createBackend.mockImplementationOnce(async () => {
        if (mode === 'throw') throw new Error('allocation')
        if (mode === 'null') return null
        const result = h.lease()
        result.expiresAt = h.deps.now() + 60_000
        return result
      })
      await h.reconciler.reconcile([source()])
      expect(h.deps.createGuard).toHaveBeenCalled()
      expect(h.published()).not.toContain('127.0.0.1:4000')
      if (mode === 'expired') expect(h.leases[0]!.close).toHaveBeenCalledTimes(1)
      await h.reconciler.close()
    }
  )

  it.each(['guard', 'publish', 'render', 'guard-expiry'])(
    'closes staged and active on %s failure, preserves YAML, and recovers',
    async failure => {
      const h = harness()
      await h.reconciler.reconcile([source()])
      const old = h.published()
      if (failure === 'guard') h.deps.createGuard.mockRejectedValueOnce(new Error('guard failed'))
      if (failure === 'publish') h.deps.publish.mockRejectedValueOnce(new Error('publish failed'))
      if (failure === 'render' || failure === 'guard-expiry')
        h.deps.createGuard.mockImplementationOnce(async () => {
          const result = h.lease()
          if (failure === 'render') result.tls.certificatePem = 'invalid'
          else result.expiresAt = h.deps.now() + 59_999
          return result
        })
      await expect(h.reconciler.reconcile([source(), source('local')])).rejects.toThrow()
      expect(h.published()).toBe(old)
      expect(h.leases.every(lease => vi.mocked(lease.close).mock.calls.length === 1)).toBe(true)
      await h.reconciler.reconcile([source()])
      expect(h.published()).not.toBe(old)
      await h.reconciler.close()
    }
  )

  it('surfaces cleanup failures while still closing all resources', async () => {
    const h = harness()
    await h.reconciler.reconcile([source()])
    vi.mocked(h.leases[0]!.close).mockRejectedValueOnce(new Error('cleanup failure'))
    h.deps.publish.mockRejectedValueOnce(new Error('publication failure'))
    await expect(h.reconciler.reconcile([source(), source('local')])).rejects.toBeInstanceOf(
      AggregateError
    )
    expect(h.leases.every(lease => vi.mocked(lease.close).mock.calls.length === 1)).toBe(true)
    await h.reconciler.close()
  })

  it('coalesces pending frames, skips superseded staging, and shares bounded completion', async () => {
    const h = harness()
    const started = deferred()
    const unblock = deferred()
    h.deps.createBackend.mockImplementationOnce(async () => {
      started.resolve()
      await unblock.promise
      return h.lease()
    })
    const first = h.reconciler.reconcile([source()])
    await started.promise
    const second = h.reconciler.reconcile([source('second')])
    const last = h.reconciler.reconcile([source('last')])
    expect(first).toBe(second)
    expect(second).toBe(last)
    unblock.resolve()
    await last
    expect(h.deps.publish).toHaveBeenCalledTimes(1)
    expect(h.deps.createBackend.mock.calls.map(([a]) => a.source.owner.id)).toEqual([
      'remote',
      'last',
    ])
    expect(h.leases[0]!.close).toHaveBeenCalledTimes(1)
    await h.reconciler.close()
  })

  it('serializes publication and does not resolve old callers until the newest publish finishes', async () => {
    const h = harness()
    const started = deferred()
    const unblock = deferred()
    h.deps.publish.mockImplementationOnce(async () => {
      started.resolve()
      await unblock.promise
    })
    const first = h.reconciler.reconcile([source()])
    await started.promise
    const last = h.reconciler.reconcile([source('last')])
    expect(h.deps.publish).toHaveBeenCalledTimes(1)
    unblock.resolve()
    await Promise.all([first, last])
    expect(h.deps.publish).toHaveBeenCalledTimes(2)
    await h.reconciler.close()
  })

  it('close during allocation prevents publication, closes returned resources, and is idempotent', async () => {
    const h = harness()
    const started = deferred()
    const unblock = deferred()
    h.deps.createBackend.mockImplementationOnce(async () => {
      started.resolve()
      await unblock.promise
      return h.lease()
    })
    const run = h.reconciler.reconcile([source()])
    const rejected = expect(run).rejects.toThrow('closed')
    await started.promise
    const close = h.reconciler.close()
    expect(h.reconciler.close()).toBe(close)
    await expect(h.reconciler.reconcile([])).rejects.toThrow('closed')
    unblock.resolve()
    await rejected
    await close
    expect(h.deps.publish).not.toHaveBeenCalled()
    expect(h.leases[0]!.close).toHaveBeenCalledTimes(1)
  })

  it('rejects pending callers when closed before the worker starts', async () => {
    const h = harness()
    const run = h.reconciler.reconcile([source()])
    const rejection = expect(run).rejects.toThrow('closed')
    await h.reconciler.close()
    await rejection
    expect(h.deps.prepareProxy).not.toHaveBeenCalled()
  })

  it('waits for an already invoked atomic publication when closing', async () => {
    const h = harness()
    const started = deferred()
    const unblock = deferred()
    h.deps.publish.mockImplementationOnce(async () => {
      started.resolve()
      await unblock.promise
    })
    const run = h.reconciler.reconcile([source()])
    const rejection = expect(run).rejects.toThrow('closed')
    await started.promise
    const closing = h.reconciler.close()
    expect(h.leases[0]!.close).not.toHaveBeenCalled()
    unblock.resolve()
    await closing
    await rejection
    expect(h.leases[0]!.close).toHaveBeenCalledTimes(1)
    expect(h.deps.publish).toHaveBeenCalledTimes(1)
  })

  it('rechecks lease lifetime after expensive staging', async () => {
    const h = harness()
    h.deps.createGuard.mockImplementationOnce(async () => {
      h.advance(60_000)
      return h.lease()
    })
    await expect(h.reconciler.reconcile([source(), source('local')])).rejects.toThrow(
      'expired during staging'
    )
    expect(h.deps.publish).not.toHaveBeenCalled()
    expect(h.leases.every(lease => vi.mocked(lease.close).mock.calls.length === 1)).toBe(true)
    await h.reconciler.close()
  })

  it('detaches caller snapshots and all factory arguments from stored plans and reuse keys', async () => {
    const h = harness()
    const input = source()
    const original = structuredClone(input)
    h.deps.createBackend.mockImplementationOnce(async args => {
      args.source.owner.id = 'mutated'
      args.endpoint.target.port = 1
      args.proxy.id = 'mutated'
      return h.lease()
    })
    const run = h.reconciler.reconcile([input])
    input.snapshot.worktrees[0]!.endpoints[0]!.target.port = 2
    input.owner.id = 'caller-mutation'
    await run
    await h.reconciler.reconcile([original])
    expect(h.deps.createBackend).toHaveBeenCalledTimes(1)
    h.deps.createGuard.mockImplementation(async args => {
      args.plan.hostname = 'mutated.invalid'
      args.proxy.id = 'mutated'
      return h.lease()
    })
    await h.reconciler.reconcile([original, source('local')])
    const guards = h.deps.createGuard.mock.calls.length
    await h.reconciler.reconcile([original, source('local')])
    expect(h.deps.createGuard).toHaveBeenCalledTimes(guards)
    expect(h.published()).not.toContain('mutated')
    await h.reconciler.close()
  })
})

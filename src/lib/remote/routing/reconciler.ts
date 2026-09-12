import type { RemoteRelayOptions } from './relay.ts'
import { renderRemoteRouteConfig } from './config.ts'
import { compileRemoteRoutePlan, type RemoteRoutePlan, type RemoteRouteSource } from './plan.ts'
import type { RemoteEndpoint } from '../session/snapshot.ts'

export type RemoteReconcilerSource = RemoteRouteSource & {
  available: boolean
  selectedSessionId?: string
}
export interface RemoteRouteLease {
  address: string
  port: number
  tls: { serverName: string; certificatePem: string }
  expiresAt: number
  /** Local capability check only; adapters may also include upstream state. No probes. */
  isAlive(): boolean
  close(): Promise<void>
}
export interface RemoteRouteProxy {
  id: string
  targetAddress: string
  bind: RemoteRelayOptions['bind']
}
export interface RemoteRouteBackendRef {
  ownerId: string
  worktreeId: string
  endpointId: string
}
export interface RemoteRouteReconciliation {
  /** Backends whose leases were staged and atomically published in this frame. */
  readyBackends: readonly RemoteRouteBackendRef[]
}
export interface RemoteRouteReconcilerDependencies {
  /** Preserve other writers' port union and inspect current Traefik before returning. */
  prepareProxy(sortedPortsExcluding80: number[]): Promise<RemoteRouteProxy>
  /** Factories own cleanup of partially allocated resources when throwing. */
  createBackend(input: {
    source: RemoteReconcilerSource
    worktreeId: string
    endpoint: RemoteEndpoint
    proxy: RemoteRouteProxy
  }): Promise<RemoteRouteLease | null>
  createGuard(input: {
    plan: RemoteRoutePlan
    status: 'conflict' | 'unavailable'
    proxy: RemoteRouteProxy
  }): Promise<RemoteRouteLease>
  /** Must atomically replace YAML, leaving the previous content intact on failure. */
  publish(content: string, readyBackends: readonly RemoteRouteBackendRef[]): Promise<void>
  now?(): number
}

const key = (value: unknown): string => JSON.stringify(value)
const copy = <T>(value: T): T => structuredClone(value)
const refKey = (ownerId: string, worktreeId: string, endpointId: string) =>
  key([ownerId, worktreeId, endpointId])

/** In-memory lease owner. No timers: callers must reconcile periodically for rotation.
 * One running frame, one replaceable pending frame, and one shared completion promise.
 * Calls during publication cannot undo that atomic callback; close waits for it to finish.
 */
export function createRemoteRouteReconciler(deps: RemoteRouteReconcilerDependencies) {
  const now = deps.now ?? Date.now
  let active = new Map<string, RemoteRouteLease>()
  let pending: RemoteReconcilerSource[] | undefined
  let running: Promise<RemoteRouteReconciliation> | undefined
  let closing: Promise<void> | undefined
  let closed = false
  const fresh = (lease: RemoteRouteLease): boolean => {
    try {
      return (
        lease.isAlive() === true &&
        Number.isFinite(lease.expiresAt) &&
        lease.expiresAt - now() > 60_000
      )
    } catch {
      return false
    }
  }

  async function dispose(leases: Iterable<RemoteRouteLease>): Promise<void> {
    const results = await Promise.allSettled(
      [...new Set(leases)].map(lease => Promise.resolve().then(() => lease.close()))
    )
    const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
    if (errors.length) throw new AggregateError(errors, 'Remote route cleanup failed')
  }

  async function frame(sources: RemoteReconcilerSource[]): Promise<RemoteRouteReconciliation> {
    const staged = new Set<RemoteRouteLease>()
    try {
      // ALL ownership is compiled before any backend allocation, including retained claims.
      const plans = compileRemoteRoutePlan(sources)
      for (const source of sources) {
        if (
          typeof source.available !== 'boolean' ||
          (source.available && source.owner.kind === 'ssh' && !source.selectedSessionId?.trim())
        )
          throw new Error('Available SSH source requires a selected session')
      }
      const proxy = copy(
        await deps.prepareProxy(
          [...new Set(plans.map(plan => plan.port))]
            .filter(port => port !== 80)
            .sort((a, b) => a - b)
        )
      )
      const proxyKey = [
        proxy.id,
        proxy.targetAddress,
        proxy.bind.kind,
        proxy.bind.kind === 'docker-bridge' ? [proxy.bind.address, proxy.bind.peerAddress] : null,
      ]
      const next = new Map<string, RemoteRouteLease>()
      const backends = new Map<string, RemoteRouteLease>()
      const guards = new Map<string, RemoteRouteLease>()
      const interrupted = () => closed || pending !== undefined
      async function acquire(resourceKey: string, factory: () => Promise<RemoteRouteLease | null>) {
        const prior = active.get(resourceKey)
        if (prior && fresh(prior)) {
          next.set(resourceKey, prior)
          return prior
        }
        const result = await factory()
        if (!result) return undefined
        // Detach descriptors and capture methods so later method replacement cannot retarget them.
        const cleanup = result.close.bind(result)
        const lease = {
          address: result.address,
          port: result.port,
          tls: result.tls,
          expiresAt: result.expiresAt,
          close: cleanup,
          isAlive: result.isAlive.bind(result),
        }
        staged.add(lease)
        lease.tls = copy(result.tls)
        if (!fresh(lease)) return undefined
        next.set(resourceKey, lease)
        return lease
      }
      if (!interrupted())
        for (const source of sources) {
          if (!source.available) continue
          for (const tree of source.snapshot.worktrees)
            for (const endpoint of tree.endpoints) {
              if (interrupted()) break
              const resourceKey = key([
                'backend',
                source.owner,
                tree.worktreeId,
                endpoint.id,
                endpoint.target.address,
                endpoint.target.port,
                source.selectedSessionId,
                proxyKey,
              ])
              const lease = await acquire(resourceKey, async () => {
                try {
                  return await deps.createBackend(
                    copy({ source, worktreeId: tree.worktreeId, endpoint, proxy })
                  )
                } catch {
                  return null // Fail closed with a guard, never another owner or direct target.
                }
              })
              if (lease) backends.set(refKey(source.owner.id, tree.worktreeId, endpoint.id), lease)
            }
        }
      for (const plan of plans) {
        if (interrupted()) break
        const ref = plan.endpoint
        if (ref && backends.has(refKey(ref.ownerId, ref.worktreeId, ref.endpointId))) continue
        const status = plan.resolution.status === 'conflict' ? 'conflict' : 'unavailable'
        const lease = await acquire(key(['guard', plan, status, proxyKey]), () =>
          deps.createGuard(copy({ plan, status, proxy }))
        )
        if (!lease) throw new Error('Guard lease is not live or expires too soon')
        guards.set(key(plan), lease)
      }
      if (closed) throw new Error('Remote route reconciler is closed')
      if (pending) {
        const abandoned = [...staged]
        staged.clear()
        await dispose(abandoned)
        return { readyBackends: [] }
      }
      if ([...next.values()].some(lease => !fresh(lease)))
        throw new Error('Route lease expired during staging or is not live')
      const { content } = renderRemoteRouteConfig(plans, {
        backend: ref => backends.get(refKey(ref.ownerId, ref.worktreeId, ref.endpointId)),
        guard: plan => guards.get(key(plan))!,
      })
      const readyBackends = plans.flatMap(plan => {
        const endpoint = plan.endpoint
        return endpoint &&
          backends.has(refKey(endpoint.ownerId, endpoint.worktreeId, endpoint.endpointId))
          ? [endpoint]
          : []
      })
      await deps.publish(content, readyBackends)
      const retained = new Set(next.values())
      const obsolete = [...active.values(), ...staged].filter(lease => !retained.has(lease))
      active = next
      staged.clear()
      await dispose(obsolete)
      return { readyBackends }
    } catch (error) {
      const doomed = [...active.values(), ...staged]
      active = new Map()
      staged.clear()
      try {
        await dispose(doomed)
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Remote route generation and cleanup failed'
        )
      }
      throw error
    }
  }

  async function drain(): Promise<RemoteRouteReconciliation> {
    let result: RemoteRouteReconciliation = { readyBackends: [] }
    try {
      while (pending && !closed) {
        const sources = pending
        pending = undefined
        result = await frame(sources)
      }
      if (closed) throw new Error('Remote route reconciler is closed')
      return result
    } finally {
      pending = undefined
      running = undefined
    }
  }
  return {
    reconcile(sources: readonly RemoteReconcilerSource[]): Promise<RemoteRouteReconciliation> {
      if (closed) return Promise.reject(new Error('Remote route reconciler is closed'))
      try {
        pending = copy([...sources])
      } catch (error) {
        return Promise.reject(error)
      }
      running ??= Promise.resolve().then(drain)
      return running
    },
    close(): Promise<void> {
      if (closing) return closing
      closed = true
      pending = undefined
      closing = (async () => {
        let failure: unknown
        try {
          await running
        } catch (error) {
          if (error instanceof AggregateError) failure = error
        }
        const doomed = active
        active = new Map()
        await dispose(doomed.values())
        if (failure) throw failure
      })()
      return closing
    },
  }
}

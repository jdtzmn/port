import { connect } from 'node:net'
import { ensureTraefikDynamicDir } from './traefik.ts'
import { getRemoteRuntimePaths } from './remoteRuntimePaths.ts'
import {
  startRemoteCoordinatorControl,
  requestRemoteCoordinator,
} from './remoteCoordinatorControl.ts'
import { createRemoteOwnerRegistry } from './remoteOwnerRegistry.ts'
import { allocateRemoteOwners } from './remoteOwnerStore.ts'
import {
  createRemoteCoordinatorState,
  restoreRemoteCoordinatorState,
} from './remoteCoordinatorState.ts'
import {
  pinRemoteSessionObservation,
  restoreRemoteSessionObservation,
  openRemoteStream,
  type RemoteSessionObservationHandle,
} from './remoteSession.ts'
import { collectRemoteSnapshot } from './remoteSnapshotCollector.ts'
import {
  createRemoteRouteReconciler,
  type RemoteReconcilerSource,
  type RemoteRouteProxy,
} from './remoteRouteReconciler.ts'
import { startSecureRemoteRelay } from './remoteRelay.ts'
import { startSecureRemoteRouteGuard } from './remoteRouteGuard.ts'
import { prepareRemoteProxy } from './remoteProxy.ts'
import {
  createRemotePublisher,
  readRemoteCatalog,
  readRemoteCheckpoint,
  registerRemotePin,
  type RemoteRuntimeCheckpoint,
} from './remoteRuntimeStore.ts'
import { selectSupportedRemoteWorktrees } from './remoteRoutePolicy.ts'
import { buildRemoteRouteSnapshot } from './remoteRouteSnapshot.ts'
import type { RemoteSnapshot } from './remoteSnapshot.ts'

/** One serial resource worker. Control admissions are journalled separately from route frames. */
export async function startRemoteRuntime(options: {
  root: string
  controlRoot: string
  dynamicDirectory: string
  collectLocal?: (revision: number) => Promise<RemoteSnapshot>
  prepareProxy?: (ports: number[]) => Promise<RemoteRouteProxy>
}) {
  const { root, controlRoot, dynamicDirectory } = options
  let stopped = false
  let wake: (() => void) | undefined
  let failure: unknown
  const control = await startRemoteCoordinatorControl(controlRoot, {
    async register(directory, signal) {
      signal.throwIfAborted()
      const handle = pinRemoteSessionObservation(directory)
      if (!handle) throw new Error('Session unavailable')
      await registerRemotePin(root, handle.checkpoint())
      wake?.()
    },
    async wake() {
      wake?.()
    },
    async shutdown() {
      stopped = true
      wake?.()
    },
  })
  if (!control) return null
  let owners = createRemoteOwnerRegistry().serialize()
  let registry = createRemoteOwnerRegistry(owners)
  const registryView = {
    resolve: (...args: Parameters<typeof registry.resolve>) => registry.resolve(...args),
    serialize: () => registry.serialize(),
  }
  const handles = new Map<string, RemoteSessionObservationHandle>()
  let reconciler: ReturnType<typeof createRemoteRouteReconciler> | undefined
  let local: RemoteSnapshot | null = null
  let localReady = false
  let frame: RemoteRuntimeCheckpoint | undefined
  try {
    owners = await allocateRemoteOwners(root, [])
    registry = createRemoteOwnerRegistry(owners)
    const saved = await readRemoteCheckpoint(root, owners)
    const state = saved
      ? restoreRemoteCoordinatorState(registryView, saved.ownership)
      : createRemoteCoordinatorState(registryView)
    for (const pin of saved?.pins ?? [])
      handles.set(pin.sessionId, restoreRemoteSessionObservation(pin))
    local = saved?.local ?? null
    const publisher = createRemotePublisher({
      root,
      dynamicDirectory,
      incarnation: control.incarnation,
      async isCurrent() {
        const response = await requestRemoteCoordinator(controlRoot, { version: 1, action: 'ping' })
        return response?.status === 'ok' && response.incarnation === control.incarnation
      },
    })
    await publisher.activate(owners)
    reconciler = createRemoteRouteReconciler({
      prepareProxy: options.prepareProxy ?? prepareRemoteProxy,
      async createBackend({ source, endpoint, proxy }) {
        let stream: { connect(): ReturnType<typeof connect> | null; close(): Promise<void> } | null
        if (source.owner.kind === 'ssh') {
          const handle = handles.get(source.selectedSessionId!)
          const before = handle?.read(Date.now())
          if (!handle || before?.status !== 'ready') return null
          stream = await openRemoteStream(handle.checkpoint().directory, endpoint.target)
          if (!stream) return null
          // Opening a forward must not adopt a replacement directory/master.
          if (handle.read(Date.now()).status !== 'ready') {
            await stream.close()
            return null
          }
        } else {
          const target = { ...endpoint.target }
          stream = { connect: () => connect(target.port, target.address), close: async () => {} }
        }
        const owned = stream
        try {
          const relay = await startSecureRemoteRelay({ bind: proxy.bind, stream: owned })
          let closed = false
          return {
            ...relay,
            address: proxy.targetAddress,
            isAlive: () => !closed && relay.isAlive(),
            async close() {
              closed = true
              try {
                await relay.close()
              } finally {
                await owned.close()
              }
            },
          }
        } catch (error) {
          await owned.close()
          throw error
        }
      },
      async createGuard({ plan, status, proxy }) {
        const guard = await startSecureRemoteRouteGuard(plan, status, proxy.bind)
        return { ...guard, address: proxy.targetAddress }
      },
      async publish(content) {
        if (!frame) throw new Error('Missing ownership checkpoint')
        // The serial loop cannot mutate this frame until reconciliation finishes.
        await publisher.publish(owners, frame, content)
      },
    })
    let revision = 0
    async function tick() {
      for (const pin of await readRemoteCatalog(root)) {
        if (!handles.has(pin.sessionId))
          handles.set(pin.sessionId, restoreRemoteSessionObservation(pin))
      }
      const now = Date.now()
      const observations = [...handles].map(([sessionId, handle]) => ({
        sessionId,
        observation: handle.read(now),
      }))
      owners = await allocateRemoteOwners(
        root,
        observations.flatMap(({ observation }) =>
          observation.status !== 'disconnected' && observation.snapshot
            ? [
                {
                  connectionIdentity: observation.connectionIdentity,
                  destination: observation.destination,
                  instanceId: observation.snapshot.instanceId,
                },
              ]
            : []
        )
      )
      registry = createRemoteOwnerRegistry(owners)
      for (const { sessionId, observation } of observations) {
        if (observation.status === 'disconnected') {
          state.disconnect(sessionId)
          continue
        }
        if (observation.snapshot && observation.observedAt !== undefined) {
          try {
            state.observe(
              {
                sessionId,
                connectionIdentity: observation.connectionIdentity,
                destination: observation.destination,
                snapshot: observation.snapshot,
                observedAt: observation.observedAt,
              },
              now
            )
          } catch {
            state.unavailable(sessionId)
          }
        }
        if (observation.status !== 'ready') state.unavailable(sessionId)
      }
      try {
        local = await (options.collectLocal ?? (n => collectRemoteSnapshot('local', n)))(revision++)
        localReady = true
      } catch {
        localReady = false
      }
      const sources: RemoteReconcilerSource[] = state
        .desired(Date.now())
        .map(source => ({
          ...source,
          snapshot: selectSupportedRemoteWorktrees(source.snapshot),
        }))
        .filter(source => source.snapshot.worktrees.length > 0)
      const routedLocal = local ? selectSupportedRemoteWorktrees(local) : null
      if (routedLocal)
        sources.push({
          owner: { id: 'local', kind: 'local', label: 'local' },
          snapshot: routedLocal,
          available: localReady,
        })
      frame = {
        version: 1,
        pins: [...handles.values()].map(handle => handle.checkpoint()),
        ownership: state.checkpoint(),
        routes: buildRemoteRouteSnapshot(sources),
        local,
      }
      await reconciler!.reconcile(sources)
    }
    const done = (async () => {
      try {
        while (!stopped) {
          await tick()
          if (stopped) break
          await new Promise<void>(resolve => {
            const timer = setTimeout(finish, 2000)
            function finish() {
              clearTimeout(timer)
              wake = undefined
              resolve()
            }
            wake = finish
          })
        }
      } catch (error) {
        failure = error
      } finally {
        stopped = true
        try {
          await reconciler?.close()
        } finally {
          await control.close()
        }
      }
      if (failure) throw failure
    })()
    return {
      incarnation: control.incarnation,
      done,
      async close() {
        stopped = true
        wake?.()
        await done
      },
    }
  } catch (error) {
    try {
      await reconciler?.close()
    } finally {
      await control.close()
    }
    throw error
  }
}

export async function runRemoteRuntime() {
  const paths = await getRemoteRuntimePaths()
  await ensureTraefikDynamicDir()
  const runtime = await startRemoteRuntime(paths)
  if (!runtime) return
  const stop = () => {
    void runtime.close().catch(() => {})
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  process.stdin.once('end', stop)
  process.stdin.resume()
  try {
    await runtime.done
  } finally {
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
    process.stdin.removeListener('end', stop)
    process.stdin.pause()
  }
}

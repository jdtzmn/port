import { createHash } from 'node:crypto'
import type { createRemoteOwnerRegistry } from './remoteOwnerRegistry.ts'
import type { RemoteRouteSource } from './remoteRoutePlan.ts'
import { parseRemoteSnapshot, type RemoteSnapshot } from './remoteSnapshot.ts'
import { isSshConnectionIdentity, type SshConnectionIdentity } from './sshConnectionIdentity.ts'

type Registry = ReturnType<typeof createRemoteOwnerRegistry>
type Tree = RemoteSnapshot['worktrees'][number]
interface Frame {
  identity: string
  snapshot: RemoteSnapshot
  payload: string
  observedAt: number
  ready: boolean
  ownerId: string
}
interface OwnerState {
  selected?: string
  watermark: number
  selectionFloor: number
  claims: Map<string, { tree: Tree; observedAt: number }>
}
export interface RemoteCoordinatorObservation {
  sessionId: string
  connectionIdentity: SshConnectionIdentity
  destination: string
  snapshot: unknown
  observedAt: number
}
export interface RemoteCoordinatorSource extends RemoteRouteSource {
  alias: string
  available: boolean
  selectedSessionId?: string
}
const fail = (): never => {
  throw new Error('Invalid remote coordinator state or capacity exceeded')
}
const time = (value: number) => Number.isFinite(value) && value >= 0
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const claimKey = (tree: Tree) => JSON.stringify([tree.namespace, tree.worktreeId])
function copySnapshot(value: unknown): RemoteSnapshot {
  try {
    return parseRemoteSnapshot(JSON.stringify(value))
  } catch {
    return fail()
  }
}
function canonical(snapshot: RemoteSnapshot): string {
  return JSON.stringify(
    snapshot.worktrees
      .map(tree => ({
        ...tree,
        endpoints: tree.endpoints
          .map(endpoint => ({ ...endpoint, transports: [...endpoint.transports].sort() }))
          .sort((a, b) => compare(a.id, b.id)),
      }))
      .sort((a, b) => compare(a.worktreeId, b.worktreeId))
  )
}
function identityKey(identity: SshConnectionIdentity): string {
  return JSON.stringify([identity.hostname, identity.port, identity.user, identity.contextHash])
}

/** In-memory metadata only. Unavailable claim IDs must never be used as backend identities. */
export function createRemoteCoordinatorState(
  registry: Registry,
  { freshnessMs = 6000, maxSessions = 4096 }: { freshnessMs?: number; maxSessions?: number } = {}
) {
  if (!time(freshnessMs) || !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 4096)
    fail()
  // Tombstones count against the lifetime bound; session IDs can never be reused.
  const sessions = new Map<string, Frame | null>()
  const owners = new Map<string, OwnerState>()
  let poisoned = false
  function checkId(id: string) {
    if (typeof id !== 'string' || !id.length || Buffer.byteLength(id) > 256) fail()
  }
  function room(id: string) {
    if (!sessions.has(id) && sessions.size >= maxSessions) fail()
  }
  function active(ownerId: string) {
    return [...sessions.entries()].filter(
      (entry): entry is [string, Frame] => entry[1] !== null && entry[1].ownerId === ownerId
    )
  }
  function healthy(ownerId: string, state: OwnerState, now: number): Frame | undefined {
    const selected = state.selected === undefined ? undefined : sessions.get(state.selected)
    if (!selected || selected.observedAt < state.selectionFloor) return undefined
    return active(ownerId).every(
      ([, frame]) =>
        frame.ready &&
        frame.observedAt <= now &&
        now - frame.observedAt <= freshnessMs &&
        frame.payload === selected.payload
    )
      ? selected
      : undefined
  }
  function reconcile(ownerId: string, state: OwnerState, now: number) {
    const frame = healthy(ownerId, state, now)
    if (frame)
      state.claims = new Map(
        frame.snapshot.worktrees.map(tree => [
          claimKey(tree),
          { tree, observedAt: frame.observedAt },
        ])
      )
  }
  function boundClaims() {
    let trees = 0
    let endpoints = 0
    for (const state of owners.values())
      for (const { tree } of state.claims.values()) {
        trees++
        endpoints += tree.endpoints.length
      }
    if (trees > 4096 || endpoints > 4096) {
      // Terminal failure: continuing would silently discard a known namespace guard.
      poisoned = true
      fail()
    }
  }
  return {
    /** True only for an adopted newer frame. Replays and retired IDs return false. */
    observe(input: RemoteCoordinatorObservation, now: number): boolean {
      if (poisoned) fail()
      const id = input?.sessionId
      checkId(id)
      const previous = sessions.get(id)
      if (previous === null) return false
      try {
        if (!time(now) || !time(input.observedAt) || input.observedAt > now) fail()
        if (!isSshConnectionIdentity(input.connectionIdentity)) fail()
        if (typeof input.destination !== 'string' || input.destination.length > 4096) fail()
        const identity = { ...input.connectionIdentity }
        const snapshot = copySnapshot(input.snapshot)
        const key = identityKey(identity)
        const payload = canonical(snapshot)
        if (previous) {
          if (previous.identity !== key || previous.snapshot.instanceId !== snapshot.instanceId)
            fail()
          if (snapshot.revision < previous.snapshot.revision) return false
          if (snapshot.revision === previous.snapshot.revision) {
            if (payload !== previous.payload) fail()
            return false
          }
        }
        room(id)
        const { owner } = registry.resolve(identity, snapshot.instanceId, input.destination)
        const state: OwnerState = owners.get(owner.id) ?? {
          watermark: 0,
          selectionFloor: 0,
          claims: new Map(),
        }
        state.selected ??= id
        state.watermark = Math.max(state.watermark, input.observedAt)
        const frame: Frame = {
          identity: key,
          snapshot,
          payload,
          observedAt: input.observedAt,
          ready: true,
          ownerId: owner.id,
        }
        sessions.set(id, frame)
        owners.set(owner.id, state)
        for (const tree of snapshot.worktrees) {
          const key = claimKey(tree)
          const prior = state.claims.get(key)
          if (!prior || input.observedAt >= prior.observedAt)
            state.claims.set(key, { tree, observedAt: input.observedAt })
        }
        reconcile(owner.id, state, now)
        boundClaims()
        return true
      } catch {
        if (previous) previous.ready = false
        // Also close a newly adopted frame if a post-adoption bound failed.
        const current = sessions.get(id)
        if (current) current.ready = false
        return fail()
      }
    },
    unavailable(sessionId: string): void {
      checkId(sessionId)
      const frame = sessions.get(sessionId)
      if (frame) frame.ready = false
    },
    disconnect(sessionId: string): void {
      checkId(sessionId)
      room(sessionId)
      const frame = sessions.get(sessionId)
      sessions.set(sessionId, null)
      if (!frame) return
      const state = owners.get(frame.ownerId)!
      const remaining = active(frame.ownerId)
      if (!remaining.length) {
        state.claims.clear()
        state.selected = undefined
        state.watermark = 0
        state.selectionFloor = 0
      } else if (state.selected === sessionId) {
        state.selected = remaining[0]![0]
        state.selectionFloor = state.watermark
      }
    },
    desired(now: number): RemoteCoordinatorSource[] {
      if (poisoned || !time(now)) fail()
      return registry
        .serialize()
        .records.sort((a, b) => compare(a.ownerId, b.ownerId))
        .map(record => {
          const state = owners.get(record.ownerId)
          if (state) reconcile(record.ownerId, state, now)
          const frame = state && healthy(record.ownerId, state, now)
          const snapshot: RemoteSnapshot = frame
            ? frame.snapshot
            : {
                version: 1,
                kind: 'port-service-snapshot',
                instanceId: record.instanceId,
                revision: 0,
                worktrees: state
                  ? [...state.claims.entries()]
                      .sort(([a], [b]) => compare(a, b))
                      .map(([key, { tree }]) => ({
                        ...tree,
                        worktreeId: digest(['claim-worktree', key]),
                        endpoints: tree.endpoints.map(endpoint => ({
                          ...endpoint,
                          id: digest(['claim-endpoint', key, endpoint.id]),
                        })),
                      }))
                  : [],
              }
          return {
            owner: { kind: 'ssh', id: record.ownerId, label: record.alias },
            alias: record.alias,
            snapshot: copySnapshot(snapshot),
            available: !!frame,
            ...(frame ? { selectedSessionId: state!.selected! } : {}),
          }
        })
    },
  }
}

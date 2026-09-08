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

export interface RemoteCoordinatorCheckpoint {
  version: 1
  // Session insertion order determines the successor on disconnect; retain it.
  sessions: { sessionId: string; frame: Omit<Frame, 'payload' | 'ready'> | null }[]
  owners: {
    ownerId: string
    selected: string | null
    watermark: number
    selectionFloor: number
    claims: { tree: Tree; observedAt: number }[]
  }[]
}
type Options = { freshnessMs?: number; maxSessions?: number }
type Restored = { sessions: Map<string, Frame | null>; owners: Map<string, OwnerState> }

function exact(value: unknown, keys: string): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys
  )
}
function checkId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !id.length || Buffer.byteLength(id) > 256) fail()
}
// Reject values JSON would silently omit/coerce before using the snapshot parser.
function jsonDto(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || value === null || ancestors.has(value)) fail()
  const object = value as object
  if (!Array.isArray(object) && Object.getPrototypeOf(object) !== Object.prototype) fail()
  if (
    Reflect.ownKeys(object).length !==
    Object.keys(object).length + (Array.isArray(object) ? 1 : 0)
  )
    fail()
  ancestors.add(object)
  if (
    Array.isArray(object) &&
    (Object.keys(object).length !== object.length ||
      Object.keys(object).some((key, index) => key !== String(index)))
  )
    fail()
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
    if (Array.isArray(object) && key === 'length') continue
    if (!('value' in descriptor)) fail()
    jsonDto(descriptor.value, ancestors)
  }
  ancestors.delete(object)
}

/** Validate into private maps in full; never replay observations during restoration. */
export function restoreRemoteCoordinatorState(
  registry: Registry,
  checkpoint: unknown,
  options: Options = {}
) {
  try {
    jsonDto(checkpoint)
    if (
      !exact(checkpoint, 'owners,sessions,version') ||
      checkpoint.version !== 1 ||
      !Array.isArray(checkpoint.sessions) ||
      checkpoint.sessions.length > (options.maxSessions ?? 4096) ||
      !Array.isArray(checkpoint.owners) ||
      checkpoint.owners.length > 4096
    )
      return fail()
    const records = new Map(registry.serialize().records.map(record => [record.ownerId, record]))
    const sessions = new Map<string, Frame | null>()
    const owners = new Map<string, OwnerState>()
    for (const item of checkpoint.sessions) {
      if (!exact(item, 'frame,sessionId')) return fail()
      checkId(item.sessionId)
      if (sessions.has(item.sessionId)) fail()
      if (item.frame === null) {
        sessions.set(item.sessionId, null)
        continue
      }
      const frame = item.frame
      if (
        !exact(frame, 'identity,observedAt,ownerId,snapshot') ||
        typeof frame.ownerId !== 'string' ||
        typeof frame.observedAt !== 'number' ||
        !time(frame.observedAt)
      )
        return fail()
      const record = records.get(frame.ownerId)
      const snapshot = copySnapshot(frame.snapshot)
      if (
        !record ||
        !isSshConnectionIdentity(record.connectionIdentity) ||
        frame.identity !== identityKey(record.connectionIdentity) ||
        snapshot.instanceId !== record.instanceId ||
        frame.ownerId !==
          digest([
            record.connectionIdentity.hostname,
            record.connectionIdentity.port,
            record.connectionIdentity.user,
            record.connectionIdentity.contextHash,
            snapshot.instanceId,
          ])
      )
        return fail()
      sessions.set(item.sessionId, {
        identity: identityKey(record.connectionIdentity),
        snapshot,
        payload: canonical(snapshot),
        observedAt: frame.observedAt,
        ownerId: frame.ownerId,
        ready: false,
      })
    }
    let trees = 0
    let endpoints = 0
    for (const item of checkpoint.owners) {
      if (
        !exact(item, 'claims,ownerId,selected,selectionFloor,watermark') ||
        typeof item.ownerId !== 'string' ||
        !records.has(item.ownerId) ||
        owners.has(item.ownerId) ||
        typeof item.watermark !== 'number' ||
        !time(item.watermark) ||
        typeof item.selectionFloor !== 'number' ||
        !time(item.selectionFloor) ||
        item.selectionFloor > item.watermark ||
        !Array.isArray(item.claims)
      )
        return fail()
      const watermark = item.watermark
      const live = [...sessions.entries()].filter(([, frame]) => frame?.ownerId === item.ownerId)
      if (live.length) {
        if (
          typeof item.selected !== 'string' ||
          sessions.get(item.selected)?.ownerId !== item.ownerId ||
          live.some(([, frame]) => frame!.observedAt > watermark)
        )
          fail()
      } else if (
        item.selected !== null ||
        item.watermark !== 0 ||
        item.selectionFloor !== 0 ||
        item.claims.length
      )
        fail()
      const claims: OwnerState['claims'] = new Map()
      for (const claim of item.claims) {
        if (
          ++trees > 4096 ||
          !exact(claim, 'observedAt,tree') ||
          typeof claim.observedAt !== 'number' ||
          !time(claim.observedAt) ||
          claim.observedAt > item.watermark
        )
          return fail()
        // Different historical namespaces may share the same original worktree ID.
        const tree = copySnapshot({
          version: 1,
          kind: 'port-service-snapshot',
          instanceId: records.get(item.ownerId)!.instanceId,
          revision: 0,
          worktrees: [claim.tree],
        }).worktrees[0]!
        endpoints += tree.endpoints.length
        if (endpoints > 4096 || claims.has(claimKey(tree))) fail()
        claims.set(claimKey(tree), { tree, observedAt: claim.observedAt })
      }
      owners.set(item.ownerId, {
        selected: item.selected === null ? undefined : (item.selected as string),
        watermark: item.watermark,
        selectionFloor: item.selectionFloor,
        claims,
      })
    }
    for (const frame of sessions.values()) if (frame && !owners.has(frame.ownerId)) fail()
    return coordinator(registry, options, { sessions, owners })
  } catch {
    return fail()
  }
}

/** In-memory metadata only. Unavailable claim IDs must never be used as backend identities. */
export function createRemoteCoordinatorState(registry: Registry, options: Options = {}) {
  return coordinator(registry, options)
}
function coordinator(
  registry: Registry,
  { freshnessMs = 6000, maxSessions = 4096 }: Options,
  restored?: Restored
) {
  if (!time(freshnessMs) || !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 4096)
    fail()
  // Tombstones count against the lifetime bound; session IDs can never be reused.
  const sessions = restored?.sessions ?? new Map<string, Frame | null>()
  const owners = restored?.owners ?? new Map<string, OwnerState>()
  let poisoned = false
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
    checkpoint(): RemoteCoordinatorCheckpoint {
      if (poisoned) fail()
      return {
        version: 1,
        sessions: [...sessions].map(([sessionId, frame]) => ({
          sessionId,
          frame: frame
            ? {
                identity: frame.identity,
                snapshot: copySnapshot(frame.snapshot),
                observedAt: frame.observedAt,
                ownerId: frame.ownerId,
              }
            : null,
        })),
        owners: [...owners]
          .sort(([a], [b]) => compare(a, b))
          .map(([ownerId, state]) => ({
            ownerId,
            selected: state.selected ?? null,
            watermark: state.watermark,
            selectionFloor: state.selectionFloor,
            claims: [...state.claims]
              .sort(([a], [b]) => compare(a, b))
              .map(([, claim]) => ({
                tree: copySnapshot({
                  version: 1,
                  kind: 'port-service-snapshot',
                  instanceId: 'claim',
                  revision: 0,
                  worktrees: [claim.tree],
                }).worktrees[0]!,
                observedAt: claim.observedAt,
              })),
          })),
      }
    },
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

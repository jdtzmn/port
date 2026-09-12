import { describe, expect, it } from 'vitest'
import {
  createRemoteCoordinatorState,
  restoreRemoteCoordinatorState,
  type RemoteCoordinatorCheckpoint,
} from './state.ts'
import { createRemoteOwnerRegistry } from './ownerRegistry.ts'
import { compileRemoteRoutePlan } from '../routing/plan.ts'
import type { RemoteSnapshot } from '../session/snapshot.ts'

const identity = { hostname: 'host', user: 'user', port: 22, contextHash: 'a'.repeat(64) }
const snapshot = (revision = 0, namespace = 'main.port'): RemoteSnapshot => ({
  version: 1,
  kind: 'port-service-snapshot',
  instanceId: 'instance',
  revision,
  worktrees: [
    {
      worktreeId: 'b'.repeat(64),
      namespace,
      endpoints: [
        {
          id: 'c'.repeat(64),
          logicalPort: 3000,
          transports: ['http', 'tls-sni'],
          target: { address: '127.0.0.1', port: 3000 },
        },
      ],
    },
  ],
})
function setup(options = {}) {
  const registry = createRemoteOwnerRegistry()
  const state = createRemoteCoordinatorState(registry, options)
  const observe = (sessionId: string, revision = 0, at = 0, value = snapshot(revision)) =>
    state.observe(
      {
        sessionId,
        connectionIdentity: identity,
        destination: 'host',
        snapshot: value,
        observedAt: at,
      },
      at
    )
  return { registry, state, observe, desired: (now = 0) => state.desired(now)[0]! }
}

describe('remote coordinator checkpoints', () => {
  const adopt = (
    state: ReturnType<typeof createRemoteCoordinatorState>,
    sessionId: string,
    revision: number,
    at: number,
    namespace = 'main.port'
  ) =>
    state.observe(
      {
        sessionId,
        connectionIdentity: identity,
        destination: 'host',
        snapshot: snapshot(revision, namespace),
        observedAt: at,
      },
      at
    )

  it('retains original historical divergent claims through multiple restarts', () => {
    const { state, registry, observe } = setup()
    observe('z', 100, 1)
    observe('a', 0, 2, snapshot(0, 'other.port'))
    observe('z', 101, 3, snapshot(101, 'third.port'))
    observe('a', 1, 4, snapshot(1, 'fourth.port'))
    const saved = state.checkpoint()
    expect(saved.owners[0]!.claims.map(claim => claim.tree.namespace)).toEqual([
      'fourth.port',
      'main.port',
      'other.port',
      'third.port',
    ])
    expect(new Set(saved.owners[0]!.claims.map(claim => claim.tree.worktreeId)).size).toBe(1)
    const restored = restoreRemoteCoordinatorState(registry, saved)
    expect(restored.checkpoint()).toEqual(saved)
    expect(restored.desired(4)).toEqual(state.desired(4))
    expect(compileRemoteRoutePlan(restored.desired(4))).toEqual(
      compileRemoteRoutePlan(state.desired(4))
    )
    expect(restoreRemoteCoordinatorState(registry, restored.checkpoint()).checkpoint()).toEqual(
      saved
    )
    saved.sessions[0]!.frame!.snapshot.worktrees.length = 0
    saved.owners[0]!.claims[0]!.tree.endpoints[0]!.target.port = 1234
    expect(restored.checkpoint()).toEqual(state.checkpoint())
    const detached = restored.checkpoint()
    detached.owners.length = 0
    expect(restored.checkpoint().owners).toHaveLength(1)
  })

  it('starts every frame unavailable, rejects replays and recovers per session', () => {
    const { state, registry, observe } = setup()
    observe('z', 100, 10)
    observe('a', 0, 11)
    const restored = restoreRemoteCoordinatorState(registry, state.checkpoint())
    expect(restored.desired(11)[0]!.available).toBe(false)
    expect(adopt(restored, 'z', 100, 12)).toBe(false)
    expect(adopt(restored, 'a', 0, 12)).toBe(false)
    expect(restored.checkpoint()).toEqual(state.checkpoint())
    expect(adopt(restored, 'a', 1, 13)).toBe(true)
    expect(restored.desired(13)[0]!.available).toBe(false)
    expect(adopt(restored, 'z', 101, 14)).toBe(true)
    expect(restored.desired(14)[0]).toMatchObject({ available: true, selectedSessionId: 'z' })
    expect(restored.desired(6015)[0]!.available).toBe(false)
  })

  it('preserves sticky selection, successor insertion order, floors and tombstones', () => {
    const { state, registry, observe } = setup()
    observe('selected', 100, 100)
    observe('z', 0, 50)
    observe('a', 500, 50)
    state.disconnect('selected')
    state.disconnect('unknown')
    const saved = state.checkpoint()
    expect(saved.owners[0]).toMatchObject({ selected: 'z', watermark: 100, selectionFloor: 100 })
    const restored = restoreRemoteCoordinatorState(registry, saved)
    expect(restored.checkpoint()).toEqual(saved)
    expect(adopt(restored, 'selected', 101, 101)).toBe(false)
    expect(adopt(restored, 'unknown', 1, 101)).toBe(false)
    adopt(restored, 'z', 1, 99)
    adopt(restored, 'a', 501, 99)
    expect(restored.desired(100)[0]!.available).toBe(false)
    adopt(restored, 'z', 2, 100)
    expect(restored.desired(100)[0]).toMatchObject({ available: true, selectedSessionId: 'z' })
    const next = restoreRemoteCoordinatorState(registry, saved)
    next.disconnect('z')
    expect(next.checkpoint().owners[0]!.selected).toBe('a')
    next.disconnect('a')
    expect(restoreRemoteCoordinatorState(registry, next.checkpoint()).checkpoint()).toEqual(
      next.checkpoint()
    )
  })

  it('enforces aggregate claim caps and validates foreign live selection', () => {
    const { state, registry, observe } = setup()
    observe('a', 0, 1)
    state.observe(
      {
        sessionId: 'foreign',
        connectionIdentity: { ...identity, port: 2222 },
        destination: 'host',
        snapshot: snapshot(),
        observedAt: 1,
      },
      1
    )
    const saved = state.checkpoint()
    const owner = saved.owners.find(item => item.selected === 'a')!
    owner.selected = 'foreign'
    expect(() => restoreRemoteCoordinatorState(registry, saved)).toThrow()
    owner.selected = 'a'
    const tree = snapshot().worktrees[0]!
    owner.claims = Array.from({ length: 4096 }, (_, index) => ({
      observedAt: 1,
      tree: { ...tree, namespace: `n${index}.port` },
    }))
    expect(() => restoreRemoteCoordinatorState(registry, saved)).toThrow()
    owner.claims = [
      {
        observedAt: 1,
        tree: {
          ...tree,
          endpoints: Array.from({ length: 4096 }, (_, index) => ({
            ...tree.endpoints[0]!,
            id: index.toString(16).padStart(64, '0'),
          })),
        },
      },
    ]
    expect(() => restoreRemoteCoordinatorState(registry, saved)).toThrow()
    const overflow = state.checkpoint()
    overflow.sessions = Array.from({ length: 4097 }, (_, index) => ({
      sessionId: String(index),
      frame: null,
    }))
    expect(() => restoreRemoteCoordinatorState(registry, overflow)).toThrow()
  })

  it('rejects invalid DTOs atomically without changing the registry or source', () => {
    const { state, registry, observe } = setup()
    observe('a', 1, 10)
    state.disconnect('dead')
    const baseline = state.checkpoint()
    const reservations = registry.serialize()
    const mutations: ((value: RemoteCoordinatorCheckpoint) => void)[] = [
      value => {
        Object.assign(value, { version: 2 })
      },
      value => {
        Object.assign(value, { extra: true })
      },
      value => {
        value.sessions.push(value.sessions[0]!)
      },
      value => {
        value.owners.push(value.owners[0]!)
      },
      value => {
        value.sessions[0]!.sessionId = ''
      },
      value => {
        value.sessions[0]!.sessionId = 'x'.repeat(257)
      },
      value => {
        value.sessions[0]!.frame!.ownerId = 'missing'
      },
      value => {
        value.sessions[0]!.frame!.identity = '[]'
      },
      value => {
        value.sessions[0]!.frame!.snapshot.instanceId = 'wrong'
      },
      value => {
        value.sessions[0]!.frame!.snapshot.revision = -1
      },
      value => {
        Object.assign(value.sessions[0]!.frame!, { ready: true })
      },
      value => {
        value.sessions[0]!.frame!.observedAt = 11
      },
      value => {
        value.owners[0]!.selected = 'dead'
      },
      value => {
        value.owners[0]!.selected = null
      },
      value => {
        value.owners[0]!.watermark = -1
      },
      value => {
        value.owners[0]!.selectionFloor = 11
      },
      value => {
        value.owners[0]!.selectionFloor = Infinity
      },
      value => {
        value.owners[0]!.claims[0]!.observedAt = 11
      },
      value => {
        value.owners[0]!.claims.push(value.owners[0]!.claims[0]!)
      },
      value => {
        value.owners[0]!.claims[0]!.tree.endpoints[0]!.target.address = '8.8.8.8'
      },
      value => {
        value.owners.length = 0
      },
      value => {
        value.owners[0]!.ownerId = 'missing'
      },
      value => {
        value.sessions.length = 0
      },
      value => {
        Object.assign(value.sessions[0]!.frame!.snapshot, { extra: undefined })
      },
      value => {
        value.owners[0]!.claims = Array.from({ length: 4097 }, () => value.owners[0]!.claims[0]!)
      },
    ]
    for (const mutate of mutations) {
      const value = structuredClone(baseline)
      mutate(value)
      expect(() => restoreRemoteCoordinatorState(registry, value)).toThrow(
        'Invalid remote coordinator'
      )
      expect(registry.serialize()).toEqual(reservations)
      expect(state.checkpoint()).toEqual(baseline)
    }
    expect(() => restoreRemoteCoordinatorState(registry, baseline, { maxSessions: 1 })).toThrow()
    expect(() => restoreRemoteCoordinatorState(registry, baseline, { freshnessMs: -1 })).toThrow()
    expect(() => restoreRemoteCoordinatorState(createRemoteOwnerRegistry(), baseline)).toThrow()
  })
})

describe('remote coordinator metadata state', () => {
  it('orders revisions per session and keeps the first session selected', () => {
    const { observe, desired } = setup()
    observe('first', 100)
    observe('second', 0, 1)
    expect(desired(1)).toMatchObject({ available: true, selectedSessionId: 'first' })
    observe('second', 1, 2)
    expect(desired(2).snapshot.revision).toBe(100)
  })
  it('ignores old/replayed frames without refreshing or recovering', () => {
    const { state, observe, desired } = setup()
    observe('a', 2)
    expect(observe('a', 1, 5000)).toBe(false)
    expect(observe('a', 2, 5000)).toBe(false)
    expect(desired(6000).available).toBe(true)
    expect(desired(6001).available).toBe(false)
    state.unavailable('a')
    observe('a', 2, 6002)
    expect(desired(6002).available).toBe(false)
    observe('a', 3, 6003)
    expect(desired(6003).available).toBe(true)
  })
  it('rejects same revision contradictions and invalid snapshots without losing claims', () => {
    const { state, observe, desired } = setup()
    observe('a')
    expect(() => observe('a', 0, 1, snapshot(0, 'other.port'))).toThrow(
      'Invalid remote coordinator'
    )
    expect(desired(1).available).toBe(false)
    expect(desired(1).snapshot.worktrees[0]!.namespace).toBe('main.port')
    observe('a', 1, 2)
    expect(() =>
      state.observe(
        {
          sessionId: 'a',
          connectionIdentity: identity,
          destination: 'host',
          snapshot: {},
          observedAt: 3,
        },
        3
      )
    ).toThrow()
    expect(desired(3).snapshot.worktrees).toHaveLength(1)
    expect(desired(3).available).toBe(false)
  })
  it('isolates cloned instance IDs by addressing tuple and rejects session identity changes', () => {
    const { state, observe, registry } = setup()
    observe('a')
    const input = {
      sessionId: 'b',
      connectionIdentity: { ...identity, port: 2222 },
      destination: 'host',
      snapshot: snapshot(),
      observedAt: 0,
    }
    state.observe(input, 0)
    expect(state.desired(0)).toHaveLength(2)
    expect(new Set(state.desired(0).map(source => source.alias)).size).toBe(2)
    expect(() => state.observe({ ...input, sessionId: 'a' }, 0)).toThrow()
    expect(registry.serialize().records).toHaveLength(2)
    expect(state.desired(0).filter(source => source.available)).toHaveLength(1)
    expect(() =>
      state.observe({ ...input, snapshot: { ...snapshot(1), instanceId: 'changed' } }, 0)
    ).toThrow()
    expect(state.desired(0).every(source => !source.available)).toBe(true)
  })
  it('retains divergent namespace claims sharing original IDs and compiles them safely', () => {
    const { state, observe, desired } = setup()
    observe('a')
    observe('b', 0, 1, snapshot(0, 'other.port'))
    const source = desired(1)
    expect(source.available).toBe(false)
    expect(source).not.toHaveProperty('selectedSessionId')
    expect(source.snapshot.worktrees.map(tree => tree.namespace).sort()).toEqual([
      'main.port',
      'other.port',
    ])
    expect(new Set(source.snapshot.worktrees.map(tree => tree.worktreeId)).size).toBe(2)
    expect(compileRemoteRoutePlan(state.desired(1)).map(plan => plan.hostname)).toContain(
      'other.host.ssh'
    )
    expect(desired(10000).snapshot.worktrees).toHaveLength(2)
    observe('a', 1, 10001, snapshot(1, 'other.port'))
    observe('b', 1, 10001, snapshot(1, 'other.port'))
    expect(desired(10001).available).toBe(true)
    expect(desired(10001).snapshot.worktrees).toHaveLength(1)
  })
  it('requires the survivor to catch up to the watermark on selected disconnect', () => {
    const { state, observe, desired } = setup()
    observe('selected', 4, 100)
    observe('survivor', 0, 50)
    expect(desired(100).available).toBe(true)
    state.disconnect('selected')
    expect(desired(100).available).toBe(false)
    observe('survivor', 1, 99)
    expect(desired(100).available).toBe(false)
    observe('survivor', 2, 100)
    expect(desired(100)).toMatchObject({ available: true, selectedSessionId: 'survivor' })
    expect(observe('selected', 5, 101)).toBe(false)
  })
  it('allows healthy service removals but retains reservations after disconnect', () => {
    const { state, registry, observe, desired } = setup()
    observe('a')
    observe('a', 1, 1, { ...snapshot(1), worktrees: [] })
    expect(desired(1).snapshot.worktrees).toEqual([])
    state.disconnect('a')
    expect(desired(1)).toMatchObject({
      available: false,
      alias: 'host',
      snapshot: { worktrees: [] },
    })
    state.observe(
      {
        sessionId: 'b',
        connectionIdentity: { ...identity, hostname: 'another' },
        destination: 'host',
        snapshot: snapshot(),
        observedAt: 1,
      },
      1
    )
    const plans = compileRemoteRoutePlan(state.desired(1))
    expect(plans.find(plan => plan.hostname === 'main.host.ssh')!.resolution.status).not.toBe(
      'resolved'
    )
    expect(registry.serialize().records).toHaveLength(2)
  })
  it('retires even unknown disconnected IDs without allocating owners', () => {
    const { state, observe } = setup()
    state.unavailable('unknown')
    state.disconnect('late')
    expect(observe('late')).toBe(false)
    expect(state.desired(0)).toEqual([])
  })
  it('isolates caller mutations and ignores ordering in canonical comparisons', () => {
    const { state } = setup()
    const value = snapshot()
    const connectionIdentity = { ...identity }
    const input = {
      sessionId: 'a',
      connectionIdentity,
      snapshot: value,
      destination: 'host',
      observedAt: 0,
    }
    state.observe(input, 0)
    value.worktrees[0]!.endpoints[0]!.target.port = 1234
    connectionIdentity.hostname = 'changed'
    const result = state.desired(0)
    result[0]!.snapshot.worktrees.length = 0
    result[0]!.owner.id = 'changed'
    const reordered = snapshot()
    reordered.worktrees[0]!.endpoints[0]!.transports.reverse()
    state.observe(
      { ...input, sessionId: 'b', connectionIdentity: identity, snapshot: reordered },
      0
    )
    expect(state.desired(0)[0]!.available).toBe(true)
    expect(state.desired(0)[0]!.snapshot.worktrees[0]!.endpoints[0]!.target.port).toBe(3000)
  })
  it('validates times, options, IDs and lifetime capacity with fixed errors', () => {
    for (const options of [
      { freshnessMs: -1 },
      { freshnessMs: NaN },
      { maxSessions: 0 },
      { maxSessions: 4097 },
      { maxSessions: 1.5 },
    ])
      expect(() => setup(options)).toThrow('Invalid remote coordinator state or capacity exceeded')
    const { state, observe, desired } = setup({ maxSessions: 1 })
    expect(() => observe('')).toThrow()
    expect(() => observe('x'.repeat(257))).toThrow()
    observe('a')
    for (const observedAt of [-1, Infinity, NaN, 1])
      expect(() =>
        state.observe(
          {
            sessionId: 'a',
            connectionIdentity: identity,
            destination: 'host',
            snapshot: snapshot(1),
            observedAt,
          },
          0
        )
      ).toThrow()
    expect(desired().available).toBe(false)
    expect(() => state.desired(NaN)).toThrow()
    state.disconnect('a')
    expect(() => observe('b')).toThrow()
    expect(() => state.disconnect('b')).toThrow()
    expect(observe('a')).toBe(false)
  })
  it('requires every duplicate fresh and ready, and retains latest complete selectors', () => {
    const { state, observe, desired } = setup({ freshnessMs: 10 })
    observe('a')
    observe('b', 0, 5)
    expect(desired(11).available).toBe(false)
    observe('a', 1, 11)
    expect(desired(11).available).toBe(true)
    state.unavailable('b')
    const changed = snapshot(2)
    changed.worktrees[0]!.endpoints[0]!.logicalPort = 4000
    observe('a', 2, 12, changed)
    const source = desired(12)
    expect(source.available).toBe(false)
    expect(source).not.toHaveProperty('selectedSessionId')
    expect(source.snapshot.worktrees[0]!.endpoints.map(endpoint => endpoint.logicalPort)).toEqual([
      4000,
    ])
    expect(compileRemoteRoutePlan(state.desired(12)).every(plan => plan.port === 4000)).toBe(true)
    state.disconnect('b')
    expect(desired(12).selectedSessionId).toBe('a')
    state.disconnect('a')
    const unavailable = desired(12)
    expect(unavailable).toMatchObject({
      available: false,
      snapshot: { worktrees: [expect.anything()] },
    })
    // Availability is enforced by the reconciler: resolved ownership without a backend
    // is rendered through an unavailable guard rather than falling back to another owner.
    expect(
      compileRemoteRoutePlan([unavailable]).find(plan => plan.hostname === 'main.host.ssh')
    ).toMatchObject({
      resolution: { status: 'resolved' },
    })
  })
  it('fails terminally rather than dropping overflowing retained claims', () => {
    const { state, observe } = setup()
    const large = snapshot()
    large.worktrees[0]!.endpoints = Array.from({ length: 4096 }, (_, index) => ({
      ...large.worktrees[0]!.endpoints[0]!,
      id: index.toString(16).padStart(64, '0'),
    }))
    observe('a', 0, 0, large)
    expect(() => observe('b', 0, 1, snapshot(0, 'other.port'))).toThrow()
    expect(() => state.desired(1)).toThrow('Invalid remote coordinator state or capacity exceeded')
    expect(() => state.checkpoint()).toThrow()
  })
})

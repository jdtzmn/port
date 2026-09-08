import { describe, expect, it } from 'vitest'
import { createRemoteCoordinatorState } from './remoteCoordinatorState.ts'
import { createRemoteOwnerRegistry } from './remoteOwnerRegistry.ts'
import { compileRemoteRoutePlan } from './remoteRoutePlan.ts'
import type { RemoteSnapshot } from './remoteSnapshot.ts'

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
    expect(desired(12).snapshot.worktrees).toEqual([])
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
  })
})

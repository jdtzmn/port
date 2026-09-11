import { describe, expect, it } from 'vitest'
import { compileRemoteRoutePlan, type RemoteRouteSource } from './remoteRoutePlan.ts'
import type { RemoteEndpoint } from './remoteSnapshot.ts'

const endpoint = (id = 'ep', logicalPort = 3000): RemoteEndpoint => ({
  id,
  logicalPort,
  name: 'ui',
  aliasTransports: ['http'],
  transports: ['http', 'tls-sni'],
  target: { address: '127.0.0.1', port: 49152 },
})
const source = (
  id = 'remote',
  endpoints = [endpoint()],
  namespace = 'feature.port'
): RemoteRouteSource => ({
  owner: { id, label: id, kind: id === 'local' ? 'local' : 'ssh' },
  ...(id === 'local' ? {} : { alias: id }),
  snapshot: {
    version: 1,
    kind: 'port-service-snapshot',
    instanceId: 'untrusted-not-owner',
    revision: 1,
    worktrees: [{ worktreeId: `${id}-wt`, namespace, endpoints }],
  },
})
const lookup = (sources: RemoteRouteSource[], hostname: string, port = 3000, transport = 'http') =>
  compileRemoteRoutePlan(sources).find(
    p => p.hostname === hostname && p.port === port && p.transport === transport
  )
const error = 'Invalid remote route plan metadata'

describe('compileRemoteRoutePlan', () => {
  it('returns an empty plan for no sources', () => {
    expect(compileRemoteRoutePlan([])).toEqual([])
  })
  it.each(['remote', 'local'])('emits the four HTTP forms and original TLS ports for %s', id => {
    const s = source(id)
    const qualifier = id === 'local' ? 'local.port' : 'remote.ssh'
    const plan = compileRemoteRoutePlan([s])
    expect(
      plan
        .filter(p => p.transport === 'http')
        .map(p => `${p.hostname}:${p.port}`)
        .sort()
    ).toEqual(
      [
        `feature.${qualifier}:3000`,
        'feature.port:3000',
        `ui.feature.${qualifier}:80`,
        'ui.feature.port:80',
      ].sort()
    )
    expect(plan.filter(p => p.transport === 'tls-sni').map(p => p.port)).toEqual([3000, 3000])
    expect(plan).toHaveLength(6)
    for (const route of plan) {
      expect(route.resolution.status).toBe('resolved')
      expect(route.endpoint).toEqual({ ownerId: id, worktreeId: `${id}-wt`, endpointId: 'ep' })
      if (route.resolution.status === 'resolved') {
        expect(route.resolution.service.id).toBe(`ep-${route.transport}`)
        if (route.transport === 'tls-sni') expect(route.resolution.service.name).toBeUndefined()
      }
    }
  })
  it('excludes unavailable owners from defaults while retaining their qualified guard plans', () => {
    const active = source()
    const unavailable: RemoteRouteSource = { ...source('second'), available: false }
    const defaultRoute = lookup([active, unavailable], 'ui.feature.port', 80)
    expect(defaultRoute).toMatchObject({
      resolution: { status: 'resolved' },
      endpoint: { ownerId: 'remote' },
    })
    expect(lookup([active, unavailable], 'ui.feature.second.ssh', 80)).toMatchObject({
      resolution: { status: 'resolved' },
      endpoint: { ownerId: 'second' },
    })
  })

  it.each(['local', 'second'])(
    'preserves remote/%s conflicts before transport or name filtering',
    other => {
      const a = source()
      const b = source(other, [
        {
          id: 'tls',
          logicalPort: 5432,
          transports: ['tls-sni'],
          target: { address: '127.0.0.1', port: 5432 },
        },
      ])
      const inputs = [a, b]
      const qualifier = other === 'local' ? 'local.port' : 'second.ssh'
      for (const route of compileRemoteRoutePlan(inputs).filter(
        p => p.hostname === 'feature.port' || p.hostname === 'ui.feature.port'
      )) {
        expect(route.resolution.status).toBe('conflict')
        expect(route.endpoint).toBeUndefined()
        const explicit = route.hostname.startsWith('ui.') ? 'ui.' : ''
        expect(route.alternatives).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hostname: `${explicit}feature.remote.ssh`,
              port: route.port,
            }),
            expect.objectContaining({
              hostname: `${explicit}feature.${qualifier}`,
              port: route.port,
            }),
          ])
        )
      }
      expect(lookup(inputs, `ui.feature.${qualifier}`, 80)?.resolution.status).toBe('unavailable')
      expect(lookup(inputs, `feature.${qualifier}`)?.resolution.status).toBe('unavailable')
      expect(lookup(inputs, 'feature.remote.ssh', 5432, 'tls-sni')?.resolution.status).toBe(
        'unavailable'
      )
      expect(lookup(inputs, 'ui.feature.remote.ssh', 80)?.resolution.status).toBe('resolved')
    }
  )
  it('keeps disjoint transports on the same port conflicted and missing qualified transports unavailable', () => {
    const http = source('remote', [{ ...endpoint(), transports: ['http'] }])
    const tls = source('local', [
      {
        id: 'tls',
        logicalPort: 3000,
        transports: ['tls-sni'],
        target: { address: '127.0.0.1', port: 3000 },
      },
    ])
    const inputs = [http, tls]
    expect(lookup(inputs, 'feature.port')?.resolution.status).toBe('conflict')
    expect(lookup(inputs, 'feature.port', 3000, 'tls-sni')?.resolution.status).toBe('conflict')
    expect(lookup(inputs, 'feature.local.port')?.resolution.status).toBe('unavailable')
    expect(lookup(inputs, 'feature.remote.ssh', 3000, 'tls-sni')?.resolution.status).toBe(
      'unavailable'
    )
  })
  it('emits absent-owner namespace guards', () => {
    expect(
      lookup([source(), source('second', [endpoint()], 'other.port')], 'ui.feature.second.ssh', 80)
        ?.resolution.status
    ).toBe('unavailable')
  })
  it('does not collapse distinct worktrees sharing a hostname, even for one owner', () => {
    const s = source()
    s.snapshot.worktrees.push({ ...s.snapshot.worktrees[0]!, worktreeId: 'another-repo' })
    expect(compileRemoteRoutePlan([s]).every(p => p.resolution.status === 'conflict')).toBe(true)
  })
  it('keeps endpoint ambiguity a conflict instead of deduplicating a hostname', () => {
    expect(
      compileRemoteRoutePlan([source('remote', [endpoint(), endpoint('second')])]).every(
        p => p.resolution.status === 'conflict'
      )
    ).toBe(true)
  })
  it('is sorted, deterministic under permutations, and detached from inputs', () => {
    const a = source('remote', [endpoint('z', 8080), { ...endpoint('a'), name: 'api' }])
    const b = source('local')
    const before = structuredClone([a, b])
    const plan = compileRemoteRoutePlan([a, b])
    a.snapshot.worktrees[0]!.endpoints.reverse()
    expect(compileRemoteRoutePlan([b, a])).toEqual(plan)
    expect(plan.map(p => [p.hostname, p.port, p.transport])).toEqual(
      [...plan]
        .sort(
          (a, b) =>
            (a.hostname < b.hostname ? -1 : a.hostname > b.hostname ? 1 : 0) ||
            a.port - b.port ||
            (a.transport < b.transport ? -1 : a.transport > b.transport ? 1 : 0)
        )
        .map(p => [p.hostname, p.port, p.transport])
    )
    a.snapshot.worktrees[0]!.endpoints.reverse()
    expect([a, b]).toEqual(before)
    a.owner.label = 'changed'
    expect(plan).toEqual(compileRemoteRoutePlan(before))
  })
  it('uses exact configured multi-label domains and canonical multi-label aliases', () => {
    const s = source('remote', [endpoint()], 'feature.dev.port')
    s.alias = 'team.machine'
    const plan = compileRemoteRoutePlan([s], 'dev.port')
    expect(plan.some(p => p.hostname === 'feature.team.machine.ssh')).toBe(true)
    expect(plan.some(p => p.hostname === 'feature.dev.port')).toBe(true)
  })
  it.each(['', 'UPPER', 'bad_name', '-bad', 'bad.', 'a'.repeat(64), '127.0.0.1'])(
    'rejects invalid aliases/domains: %s',
    value => {
      expect(() => compileRemoteRoutePlan([{ ...source(), alias: value }])).toThrow(error)
      expect(() => compileRemoteRoutePlan([], value)).toThrow(error)
    }
  )
  it.each(['feature.example', 'nested.feature.port', 'feature.notport'])(
    'refuses unsupported namespace %s',
    namespace => {
      expect(() => compileRemoteRoutePlan([source('remote', [endpoint()], namespace)])).toThrow(
        error
      )
    }
  )
  it('rejects duplicate sources, missing aliases, and alias ownership collisions', () => {
    const s = source()
    expect(() => compileRemoteRoutePlan([s, structuredClone(s)])).toThrow(error)
    expect(() => compileRemoteRoutePlan([{ ...s, alias: undefined }])).toThrow(error)
    expect(() => compileRemoteRoutePlan([s, { ...source('second'), alias: s.alias }])).toThrow(
      error
    )
    expect(() =>
      compileRemoteRoutePlan(
        [
          source('local', [], 'feature.ssh'),
          { ...source('remote', [], 'feature.ssh'), alias: 'local' },
        ],
        'ssh'
      )
    ).toThrow(error)
  })
  it('rejects default/qualified hostname collisions rather than overwriting decisions', () => {
    const s = source('remote', [endpoint()], 'feature.box.ssh')
    s.alias = 'box'
    expect(() => compileRemoteRoutePlan([s], 'box.ssh')).toThrow(error)
  })
  it('rejects generated names exceeding RFC length', () => {
    const s = source()
    s.alias = Array(4).fill('a'.repeat(60)).join('.')
    expect(() => compileRemoteRoutePlan([s])).toThrow(error)
  })
  it('bounds endpoint counts and output expansion without sampling', () => {
    expect(() =>
      compileRemoteRoutePlan([
        source(
          'remote',
          Array.from({ length: 4097 }, (_, i) => endpoint(String(i)))
        ),
      ])
    ).toThrow(error)
    const endpoints = Array.from({ length: 1025 }, (_, i) => ({
      ...endpoint(String(i), i + 1),
      name: undefined,
      aliasTransports: undefined,
    }))
    expect(() => compileRemoteRoutePlan([source('remote', endpoints)])).toThrow(error)
  })
})

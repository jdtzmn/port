import { describe, expect, it } from 'vitest'
import {
  createRouteResolver,
  resolveRoute,
  type RouteOwner,
  type RouteRequest,
  type RouteService,
  type WorktreeRoutes,
} from './routeOwnership'

const local: RouteOwner = { id: 'local', kind: 'local', label: 'This machine' }
const remote: RouteOwner = { id: 'ssh-a', kind: 'ssh', label: 'Remote A' }
const remoteB: RouteOwner = { id: 'ssh-b', kind: 'ssh', label: 'Remote B' }
const ui: RouteService = { id: 'ui', name: 'ui', logicalPort: 3000, protocol: 'http' }
const api: RouteService = { id: 'api', name: 'api', logicalPort: 8080, protocol: 'http' }
const db: RouteService = { id: 'db', name: 'db', logicalPort: 5432, protocol: 'tcp' }
const request: RouteRequest = { namespace: 'my-feature.port', service: { name: 'ui' } }
const routes = (
  owner: RouteOwner = local,
  services: readonly RouteService[] = [ui, api, db],
  worktreeId = 'repo/feature',
  namespace = request.namespace
): WorktreeRoutes => ({ owner, worktreeId, namespace, services })

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

describe('createRouteResolver', () => {
  it('captures inputs once and queries independent namespaces', () => {
    const services = [{ ...ui }]
    const record = routes({ ...local }, services)
    const records = [record, routes(remote, [api], 'repo/other', 'other.port')]
    const resolve = createRouteResolver(records)
    const expected = resolve(request)
    record.owner.id = 'changed'
    record.namespace = 'changed.port'
    record.worktreeId = 'changed'
    services[0]!.logicalPort = 9999
    services.push({ ...api })
    records.length = 0
    expect(resolve(request)).toEqual(expected)
    expect(resolve({ namespace: 'other.port', service: { port: 8080 } })).toMatchObject({
      status: 'resolved',
      owner: remote,
      service: api,
    })
    expect(resolve({ ...request, namespace: 'changed.port' })).toEqual({ status: 'unavailable' })
    expect(resolve({ ...request, service: { name: 'api' } })).toEqual({ status: 'unavailable' })
  })

  it('detaches resolved outputs from the compiled snapshot', () => {
    const resolve = createRouteResolver([routes()])
    const expected = resolve(request)
    const result = resolve(request)
    if (result.status !== 'resolved') throw new Error('Expected resolved')
    result.owner.id = 'changed'
    result.service.logicalPort = 9999
    result.worktreeId = 'changed'
    expect(resolve(request)).toEqual(expected)
  })

  it.each([false, true])('detaches conflict outputs (endpoint conflict: %s)', endpointConflict => {
    const records = endpointConflict
      ? [routes(local, [ui, { ...api, logicalPort: 3000 }])]
      : [routes(), routes(remote)]
    const resolve = createRouteResolver(records)
    const query = { ...request, service: { port: 3000 } }
    const expected = resolve(query)
    const result = resolve(query)
    if (result.status !== 'conflict') throw new Error('Expected conflict')
    const candidate = result.candidates[0]!
    candidate.owner.id = 'changed'
    candidate.worktreeId = 'changed'
    candidate.services[0]!.logicalPort = 9999
    candidate.services = []
    result.candidates.reverse().pop()
    expect(resolve(query)).toEqual(expected)
  })

  it('preserves invalid snapshot behavior for every subsequent query', () => {
    const records = [routes(), routes(local, [])]
    const resolve = createRouteResolver(records)
    records.pop()
    for (const namespace of [request.namespace, 'other.port']) {
      expect(resolve({ ...request, namespace })).toEqual({ status: 'invalid' })
    }
    expect(createRouteResolver([routes()])({ ...request, ownerId: '' })).toEqual({
      status: 'invalid',
    })
  })
})

describe('resolveRoute', () => {
  it.each([local, remote])('resolves a single $kind owner by name and logical port', owner => {
    const record = routes(owner)
    expect(resolveRoute([record], request)).toEqual({
      status: 'resolved',
      owner,
      worktreeId: record.worktreeId,
      service: ui,
    })
    expect(resolveRoute([record], { ...request, service: { port: 5432 } })).toEqual({
      status: 'resolved',
      owner,
      worktreeId: record.worktreeId,
      service: db,
    })
  })

  it.each([
    [local, remote],
    [remote, remoteB],
    [local, remote, remoteB],
  ])('reports all owners before service selection (%j)', (...owners) => {
    const records = owners.map(owner => routes(owner))
    const result = resolveRoute(records, request)
    expect(result).toEqual({
      status: 'conflict',
      candidates: records.map(({ owner, worktreeId }) => ({
        owner,
        worktreeId,
        services: [api, db, ui],
      })),
    })
    for (const owner of owners) {
      expect(resolveRoute(records, { ...request, ownerId: owner.id })).toMatchObject({
        status: 'resolved',
        owner,
      })
    }
  })

  it('does not combine partial remote UI and local API advertisements', () => {
    const records = [routes(remote, [ui]), routes(local, [api])]
    for (const service of [{ name: 'ui' }, { name: 'api' }, { port: 3000 }, { name: 'absent' }]) {
      expect(resolveRoute(records, { ...request, service }).status).toBe('conflict')
    }
    expect(resolveRoute(records, { ...request, ownerId: local.id })).toEqual({
      status: 'unavailable',
    })
    expect(
      resolveRoute(records, { ...request, ownerId: remote.id, service: { port: 8080 } })
    ).toEqual({ status: 'unavailable' })
  })

  it('never falls back when a qualified owner or namespace is absent', () => {
    expect(resolveRoute([routes()], { ...request, ownerId: 'missing' })).toEqual({
      status: 'unavailable',
    })
    expect(resolveRoute([routes()], { ...request, namespace: 'missing.port' })).toEqual({
      status: 'unavailable',
    })
    expect(resolveRoute([], request)).toEqual({ status: 'unavailable' })
    expect(resolveRoute([routes()], { ...request, service: { name: 'missing' } })).toEqual({
      status: 'unavailable',
    })
  })

  it('deduplicates repeat remote sessions regardless of service ordering', () => {
    expect(
      resolveRoute([routes(remote), routes({ ...remote }, [db, ui, api, { ...ui }])], request)
    ).toEqual(resolveRoute([routes(remote)], request))
  })

  it('keeps separate repository worktrees conflicting even under the same owner', () => {
    const records = [routes(remote), routes(remote, [ui], 'another-repo/feature')]
    const result = resolveRoute(records, { ...request, ownerId: remote.id })
    expect(result).toMatchObject({
      status: 'conflict',
      candidates: [{ worktreeId: 'another-repo/feature' }, { worktreeId: 'repo/feature' }],
    })
  })

  it.each([
    routes(remote, [ui]),
    routes(remote, [{ ...ui, logicalPort: 3001 }, api, db]),
    routes(remote, [{ ...ui, protocol: 'tcp' }, api, db]),
    routes({ ...remote, label: 'Changed label' }),
    routes({ ...remote, kind: 'local' }),
  ])('fails closed on contradictory repeats', disagreement => {
    for (const records of [
      [routes(remote), disagreement],
      [disagreement, routes(remote)],
    ]) {
      expect(resolveRoute(records, request)).toEqual({ status: 'invalid' })
      expect(resolveRoute(records, { ...request, ownerId: remote.id })).toEqual({
        status: 'invalid',
      })
    }
  })

  it('isolates identical ports across namespaces', () => {
    const records = [routes(), routes(remote, [ui], 'repo/other', 'other.port')]
    expect(resolveRoute(records, request)).toMatchObject({ status: 'resolved', owner: local })
    expect(resolveRoute(records, { ...request, namespace: 'other.port' })).toMatchObject({
      status: 'resolved',
      owner: remote,
    })
  })

  it('uses collision-safe owner/worktree identity tuples', () => {
    const records = [
      routes({ ...remote, id: 'a:b' }, [ui], 'c'),
      routes({ ...remote, id: 'a' }, [ui], 'b:c'),
    ]
    expect(resolveRoute(records, request).status).toBe('conflict')
  })

  it('sorts candidates and services deterministically without mutating or aliasing inputs', () => {
    const records = freeze([routes(remoteB, [ui, db, api]), routes(local), routes(remote)])
    const frozenRequest = freeze({ ...request })
    const before = JSON.stringify(records)
    const result = resolveRoute(records, frozenRequest)
    expect(resolveRoute([...records].reverse(), frozenRequest)).toEqual(result)
    expect(JSON.stringify(records)).toBe(before)
    if (result.status !== 'conflict') throw new Error('Expected conflict')
    expect(result.candidates.map(candidate => candidate.owner.id)).toEqual([
      'local',
      'ssh-a',
      'ssh-b',
    ])
    const first = result.candidates[0]!
    expect(first.services.map(service => service.name)).toEqual(['api', 'db', 'ui'])
    first.owner.label = 'Changed output'
    first.services[0]!.name = 'Changed output'
    const resolved = resolveRoute([records[0]!], frozenRequest)
    if (resolved.status !== 'resolved') throw new Error('Expected resolved')
    resolved.owner.label = 'Changed output'
    resolved.service.name = 'Changed output'
    expect(JSON.stringify(records)).toBe(before)
  })

  it.each([0, 65536, -1, 1.5, NaN, Infinity, '3000'])('rejects invalid port %s', logicalPort => {
    const record = routes(local, [{ ...ui, logicalPort } as RouteService])
    expect(resolveRoute([record], request)).toEqual({ status: 'invalid' })
  })

  it.each([1, 65535])('accepts boundary port %s', logicalPort => {
    expect(resolveRoute([routes(local, [{ ...ui, logicalPort }])], request).status).toBe('resolved')
  })

  it.each([{ ...ui, id: '' }, { ...ui, name: '  ' }, { ...ui, protocol: 'udp' }, null])(
    'rejects malformed service %j',
    service => {
      expect(resolveRoute([routes(local, [service as RouteService])], request)).toEqual({
        status: 'invalid',
      })
    }
  )

  it('rejects contradictory duplicate endpoint IDs', () => {
    expect(resolveRoute([routes(local, [ui, { ...api, id: ui.id }])], request)).toEqual({
      status: 'invalid',
    })
  })

  it('allows named HTTP endpoints to share a port, but conflicts on port selection', () => {
    const shared = { ...api, logicalPort: ui.logicalPort }
    const records = [routes(local, [ui, shared])]
    for (const service of [ui, shared]) {
      expect(resolveRoute(records, { ...request, service: { name: service.name! } })).toEqual({
        status: 'resolved',
        owner: local,
        worktreeId: 'repo/feature',
        service,
      })
    }
    expect(resolveRoute(records, { ...request, service: { port: 3000 } })).toEqual({
      status: 'conflict',
      candidates: [{ owner: local, worktreeId: 'repo/feature', services: [shared, ui] }],
    })
  })

  it('conflicts on shared aliases without blocking unique port selectors', () => {
    const shared = { ...api, name: ui.name }
    const records = [routes(local, [ui, shared])]
    expect(resolveRoute(records, request).status).toBe('conflict')
    expect(resolveRoute(records, { ...request, service: { port: 8080 } })).toMatchObject({
      status: 'resolved',
      service: shared,
    })
  })

  it('supports unnamed secondary endpoints and deduplicates exact endpoint repeats', () => {
    const secondary: RouteService = { id: 'ui-secondary', logicalPort: 3001, protocol: 'http' }
    const records = [routes(local, [ui, secondary, { ...secondary }])]
    expect(resolveRoute(records, request)).toMatchObject({ status: 'resolved', service: ui })
    expect(resolveRoute(records, { ...request, service: { port: 3001 } })).toMatchObject({
      status: 'resolved',
      service: secondary,
    })
    expect(resolveRoute(records, { ...request, service: { name: secondary.id } })).toEqual({
      status: 'unavailable',
    })
  })

  it.each([
    null,
    {},
    { ...routes(), owner: null },
    { ...routes(), owner: { ...local, id: '' } },
    { ...routes(), owner: { ...local, label: ' ' } },
    { ...routes(), owner: { ...local, kind: 'unknown' } },
    { ...routes(), worktreeId: '' },
    { ...routes(), namespace: ' ' },
    { ...routes(), services: null },
  ])('rejects malformed records without throwing: %j', record => {
    expect(resolveRoute([record as WorktreeRoutes], request)).toEqual({ status: 'invalid' })
  })

  it.each([
    null,
    {},
    { ...request, namespace: '' },
    { ...request, ownerId: '' },
    { ...request, service: { name: '' } },
    { ...request, service: { port: 0 } },
    { ...request, service: { name: 'ui', port: 3000 } },
    { ...request, service: null },
  ])('rejects malformed requests without throwing: %j', value => {
    expect(resolveRoute([routes()], value as RouteRequest)).toEqual({ status: 'invalid' })
  })

  it('fails closed for malformed snapshots, including unrelated invalid records', () => {
    expect(resolveRoute(null as unknown as WorktreeRoutes[], request)).toEqual({
      status: 'invalid',
    })
    expect(resolveRoute([routes(), null as unknown as WorktreeRoutes], request)).toEqual({
      status: 'invalid',
    })
  })

  it('retains empty-service owners in conflicts', () => {
    expect(resolveRoute([routes(remote, [])], request)).toEqual({ status: 'unavailable' })
    expect(resolveRoute([routes(remote, []), routes()], request).status).toBe('conflict')
  })
})

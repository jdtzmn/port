import { describe, expect, it } from 'vitest'
import { buildRemoteRouteSnapshot, parseRemoteRouteSnapshot } from './snapshot.ts'
import type { RemoteEndpoint } from '../session/snapshot.ts'
import type { RemoteReconcilerSource } from './reconciler.ts'

const id = (value: string) => value.repeat(64).slice(0, 64)
const endpoint: RemoteEndpoint = {
  id: id('e'),
  name: 'ui',
  aliasTransports: ['http'] as ['http'],
  logicalPort: 3000,
  transports: ['http'],
  target: { address: '172.20.0.2', port: 8080 },
}

function source(kind: 'local' | 'ssh', available = true): RemoteReconcilerSource {
  const ownerId = kind === 'local' ? 'local' : id('r')
  return {
    owner: { id: ownerId, kind, label: kind },
    ...(kind === 'ssh' ? { alias: 'remote' } : {}),
    available,
    snapshot: {
      version: 1,
      kind: 'port-service-snapshot',
      instanceId: id(kind),
      revision: 1,
      worktrees: [
        {
          worktreeId: id(kind === 'local' ? 'l' : 's'),
          namespace: 'feature.port',
          endpoints: [endpoint],
        },
      ],
    },
  }
}

describe('remote route snapshot', () => {
  it('exposes only local-CLI-safe route metadata and exact conflict alternatives', () => {
    const result = buildRemoteRouteSnapshot([source('local'), source('ssh')])
    const route = result.routes.find(route => route.hostname === 'ui.feature.port')

    expect(route).toEqual({
      hostname: 'ui.feature.port',
      port: 80,
      transport: 'http',
      availability: 'conflict',
      alternatives: [
        { alias: 'local', hostname: 'ui.feature.local.port', port: 80 },
        { alias: 'remote', hostname: 'ui.feature.remote.ssh', port: 80 },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('172.20.0.2')
    expect(JSON.stringify(result)).not.toContain('worktreeId')
    expect(JSON.stringify(result)).not.toContain('instanceId')
  })

  it('marks resolved routes unavailable when their source is not ready', () => {
    const result = buildRemoteRouteSnapshot([source('ssh', false)])
    expect(result.routes.find(route => route.hostname === 'ui.feature.port')?.availability).toBe(
      'unavailable'
    )
  })

  it.each([
    '{}',
    JSON.stringify({
      version: 1,
      routes: [{ hostname: 'ui.feature.port', port: 80, transport: 'tcp', availability: 'ready' }],
    }),
    JSON.stringify({
      version: 1,
      routes: [
        {
          hostname: 'ui.feature.port',
          port: 80,
          transport: 'http',
          availability: 'conflict',
          alternatives: [],
        },
      ],
    }),
  ])('fails closed for malformed persisted views', value => {
    expect(() => parseRemoteRouteSnapshot(value)).toThrow('Invalid remote route snapshot')
  })
})

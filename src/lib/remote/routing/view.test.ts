import { describe, expect, it } from 'vitest'
import { describeRemoteRoute, remoteHttpRoutes, remoteRouteUrl } from './view.ts'

const view = {
  version: 1 as const,
  routes: [
    {
      namespace: 'feature.port',
      hostname: 'ui.feature.port',
      port: 80,
      transport: 'http' as const,
      availability: 'ready' as const,
      serviceName: 'ui',
    },
    {
      namespace: 'feature.port',
      hostname: 'feature.port',
      port: 3000,
      transport: 'http' as const,
      availability: 'conflict' as const,
      serviceName: 'ui',
      alternatives: [{ alias: 'remote', hostname: 'feature.remote.ssh', port: 3000 }],
    },
    {
      namespace: 'feature.port',
      hostname: 'feature.port',
      port: 5432,
      transport: 'tls-sni' as const,
      availability: 'ready' as const,
    },
  ],
}

describe('remote route view helpers', () => {
  it('formats browser URLs and conflict alternatives without internal metadata', () => {
    expect(remoteRouteUrl(view.routes[0]!)).toBe('http://ui.feature.port')
    expect(describeRemoteRoute(view.routes[1]!)).toBe(
      'feature.port:3000 (conflict; use feature.remote.ssh:3000)'
    )
  })

  it('shows only HTTP URLs and filters named services', () => {
    expect(remoteHttpRoutes(view).map(route => route.hostname)).toEqual([
      'ui.feature.port',
      'feature.port',
    ])
    expect(remoteHttpRoutes(view, { serviceName: 'ui' }).map(route => route.hostname)).toEqual([
      'ui.feature.port',
      'feature.port',
    ])
    expect(remoteHttpRoutes(view, 'ui')).toHaveLength(2)
    expect(remoteHttpRoutes(view, { namespace: 'feature.port' })).toHaveLength(2)
  })
})

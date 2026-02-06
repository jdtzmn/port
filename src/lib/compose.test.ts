import { describe, test, expect } from 'vitest'
import { generateOverrideContent, getServicePorts } from './compose.ts'
import type { ParsedComposeFile } from '../types.ts'

describe('getServicePorts', () => {
  test('returns published ports from compose mappings', () => {
    const ports = getServicePorts({
      ports: [
        { published: '18000', target: 8000 },
        { published: 3001, target: 6499 },
      ],
    })

    expect(ports).toEqual([18000, 3001])
  })
})

describe('generateOverrideContent', () => {
  test('uses published port for entrypoint and target port for load balancer', () => {
    const parsedCompose: ParsedComposeFile = {
      name: 'port-demo',
      services: {
        'ui-frontend': {
          ports: [{ published: '18000', target: 8000 }],
        },
      },
    }

    const override = generateOverrideContent(parsedCompose, 'port-demo', 'port')

    expect(override).toContain('traefik.http.routers.port-demo-ui-frontend-18000.entrypoints=port18000')
    expect(override).toContain(
      'traefik.http.services.port-demo-ui-frontend-18000.loadbalancer.server.port=8000'
    )
    expect(override).not.toContain(
      'traefik.http.services.port-demo-ui-frontend-18000.loadbalancer.server.port=18000'
    )
  })

  test('keeps separate mappings when published and target differ', () => {
    const parsedCompose: ParsedComposeFile = {
      name: 'layerone',
      services: {
        'ui-frontend': {
          ports: [
            { published: 3000, target: 3000 },
            { published: 3001, target: 6499 },
          ],
        },
      },
    }

    const override = generateOverrideContent(parsedCompose, 'demo', 'port')

    expect(override).toContain('traefik.http.routers.demo-ui-frontend-3001.entrypoints=port3001')
    expect(override).toContain(
      'traefik.http.services.demo-ui-frontend-3001.loadbalancer.server.port=6499'
    )
  })
})

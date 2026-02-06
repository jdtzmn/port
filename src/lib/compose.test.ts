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
  function getContainerName(override: string): string | null {
    const match = override.match(/container_name:\s*([^\n]+)/)
    return match?.[1]?.trim() ?? null
  }

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

    expect(override).toContain(
      'traefik.http.routers.port-demo-ui-frontend-18000.entrypoints=port18000'
    )
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

  test('rewrites fixed container_name values to worktree-scoped names', () => {
    const parsedCompose: ParsedComposeFile = {
      name: 'demo',
      services: {
        web: {
          container_name: 'fixed-upstream-name',
          ports: [{ published: 3000, target: 3000 }],
        },
      },
    }

    const override = generateOverrideContent(parsedCompose, 'feature-1', 'port', 'repo-feature-1')

    expect(override).toContain('container_name: repo-feature-1-web')
    expect(override).not.toContain('container_name: fixed-upstream-name')
  })

  test('rewritten container_name is stable for a given worktree', () => {
    const parsedCompose: ParsedComposeFile = {
      name: 'demo',
      services: {
        web: {
          container_name: 'fixed-upstream-name',
        },
      },
    }

    const first = generateOverrideContent(parsedCompose, 'feature-1', 'port', 'repo-feature-1')
    const second = generateOverrideContent(parsedCompose, 'feature-1', 'port', 'repo-feature-1')

    expect(getContainerName(first)).toBe('repo-feature-1-web')
    expect(getContainerName(second)).toBe('repo-feature-1-web')
  })

  test('different worktrees generate different rewritten container_name values', () => {
    const parsedCompose: ParsedComposeFile = {
      name: 'demo',
      services: {
        web: {
          container_name: 'fixed-upstream-name',
        },
      },
    }

    const feature1 = generateOverrideContent(parsedCompose, 'feature-1', 'port', 'repo-feature-1')
    const feature2 = generateOverrideContent(parsedCompose, 'feature-2', 'port', 'repo-feature-2')

    expect(getContainerName(feature1)).toBe('repo-feature-1-web')
    expect(getContainerName(feature2)).toBe('repo-feature-2-web')
    expect(getContainerName(feature1)).not.toBe(getContainerName(feature2))
  })
})

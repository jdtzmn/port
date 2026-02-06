import { mkdtempSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  generateOverrideContent,
  getComposeFileStack,
  getServicePorts,
  renderPortVariables,
  renderUserOverrideFile,
} from './compose.ts'
import type { ParsedComposeFile } from '../types.ts'

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'port-compose-test-'))
}

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

describe('getComposeFileStack', () => {
  test('returns base compose and Port override by default', () => {
    expect(getComposeFileStack('docker-compose.yml')).toEqual([
      'docker-compose.yml',
      join('.port', 'override.yml'),
    ])
  })

  test('appends rendered user override when provided', () => {
    expect(getComposeFileStack('docker-compose.yml', join('.port', 'override.user.yml'))).toEqual([
      'docker-compose.yml',
      join('.port', 'override.yml'),
      join('.port', 'override.user.yml'),
    ])
  })
})

describe('renderPortVariables', () => {
  test('replaces both braced and bare PORT_* variables', () => {
    const rendered = renderPortVariables('branch=$PORT_BRANCH host=${PORT_DOMAIN}', {
      PORT_BRANCH: 'feature-one',
      PORT_DOMAIN: 'port',
    })

    expect(rendered).toBe('branch=feature-one host=port')
  })

  test('leaves unknown variables unchanged', () => {
    const rendered = renderPortVariables('value=${PORT_UNKNOWN}', {
      PORT_BRANCH: 'feature-one',
    })

    expect(rendered).toBe('value=${PORT_UNKNOWN}')
  })
})

describe('renderUserOverrideFile', () => {
  let worktreePath: string

  beforeEach(async () => {
    worktreePath = createTempDir()
    await mkdir(join(worktreePath, '.port'), { recursive: true })
  })

  afterEach(async () => {
    await rm(worktreePath, { recursive: true, force: true })
  })

  test('renders override-compose.yml with PORT_* variables', async () => {
    await writeFile(
      join(worktreePath, '.port', 'override-compose.yml'),
      [
        'services:',
        '  web:',
        '    labels:',
        '      - branch=$PORT_BRANCH',
        '      - host=${PORT_BRANCH}.${PORT_DOMAIN}',
        '      - compose=${PORT_COMPOSE_FILE}',
      ].join('\n')
    )

    const renderedRelativePath = await renderUserOverrideFile({
      repoRoot: '/repo',
      worktreePath,
      branch: 'feature-one',
      domain: 'port',
      composeFile: 'docker-compose.yml',
      projectName: 'repo-feature-one',
    })

    expect(renderedRelativePath).toBe(join('.port', 'override.user.yml'))

    const rendered = await readFile(join(worktreePath, '.port', 'override.user.yml'), 'utf-8')
    expect(rendered).toContain('branch=feature-one')
    expect(rendered).toContain('host=feature-one.port')
    expect(rendered).toContain('compose=docker-compose.yml')
  })

  test('returns null when override-compose.yml is missing', async () => {
    const renderedRelativePath = await renderUserOverrideFile({
      repoRoot: '/repo',
      worktreePath,
      branch: 'feature-one',
      domain: 'port',
      composeFile: 'docker-compose.yml',
      projectName: 'repo-feature-one',
    })

    expect(renderedRelativePath).toBeNull()
  })
})

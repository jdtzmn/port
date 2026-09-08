import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { generateOverrideContent } from './compose.ts'
import { buildRemoteSnapshot, type SafeContainer, type SafeHost } from './remoteSnapshot.ts'

const context = { repo: '/private/repos/my-app', branch: 'feature-one', domain: 'port' }
// Exact generateTraefikLabels layout: published 8080 -> container 3000,
// plus an HTTP-only web alias. Compose project need not equal namespace.
function container(): SafeContainer {
  const name = 'feature-one-api-8080'
  const alias = 'feature-one-api-alias'
  const labels: Record<string, string> = {
    'com.docker.compose.project': 'port-local-my-app-a1b2c3',
    'com.docker.compose.project.working_dir': '/private/repos/my-app/.port/trees/feature-one',
    'com.docker.compose.service': 'api',
    'traefik.enable': 'true',
  }
  for (const protocol of ['http', 'tcp']) {
    const prefix = `traefik.${protocol}.routers.${name}`
    labels[`${prefix}.rule`] = `${protocol === 'http' ? 'Host' : 'HostSNI'}(\`feature-one.port\`)`
    labels[`${prefix}.entrypoints`] = 'port8080'
    labels[`${prefix}.service`] = name
    labels[`traefik.${protocol}.services.${name}.loadbalancer.server.port`] = '3000'
    if (protocol === 'tcp') labels[`${prefix}.tls`] = 'true'
  }
  labels[`traefik.http.routers.${alias}.rule`] = 'Host(`api.feature-one.port`)'
  labels[`traefik.http.routers.${alias}.entrypoints`] = 'web'
  labels[`traefik.http.routers.${alias}.service`] = alias
  labels[`traefik.http.services.${alias}.loadbalancer.server.port`] = '3000'
  return {
    id: 'container-one',
    stateRunning: true,
    context: { ...context },
    labels,
    networks: { 'traefik-network': { IPAddress: '172.18.0.2' }, default: { IPAddress: '8.8.8.8' } },
  }
}
function host(): SafeHost {
  return { ...context, logicalPort: 4000, actualPort: 49100, pid: 123, running: true }
}
const snapshot = (docker: SafeContainer[] = [container()], hosts: SafeHost[] = []) =>
  buildRemoteSnapshot({ instanceId: 'machine-1', revision: 7, docker, hosts })

describe('buildRemoteSnapshot', () => {
  it('accepts labels emitted by the actual Compose override generator', () => {
    const generated = generateOverrideContent(
      {
        name: 'my-app',
        services: { api: { ports: [{ published: 8080, target: 3000, protocol: 'tcp' }] } },
      },
      context.branch,
      context.domain
    )
    const labels: string[] = parse(generated.replaceAll('!override []', '[]')).services.api.labels
    const source = container()
    source.labels = { 'com.docker.compose.service': 'api' }
    for (const label of labels) {
      const separator = label.indexOf('=')
      source.labels[label.slice(0, separator)] = label.slice(separator + 1)
    }
    expect(snapshot([source])).toEqual(snapshot())
  })

  it('extracts one direct endpoint with both actual transports and an HTTP-only alias', () => {
    const result = snapshot()
    expect(result).toMatchObject({
      version: 1,
      kind: 'port-service-snapshot',
      instanceId: 'machine-1',
      revision: 7,
    })
    expect(result.worktrees).toHaveLength(1)
    expect(result.worktrees[0]!.namespace).toBe('feature-one.port')
    expect(result.worktrees[0]!.endpoints).toEqual([
      {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        logicalPort: 8080,
        name: 'api',
        aliasTransports: ['http'],
        transports: ['http', 'tls-sni'],
        target: { address: '172.18.0.2', port: 3000 },
      },
    ])
    const encoded = JSON.stringify(result)
    for (const forbidden of [
      '/private',
      'working_dir',
      'labels',
      'command',
      'Env',
      'port-local',
      'container-one',
    ]) {
      expect(encoded).not.toContain(forbidden)
    }
  })
  it('merges Docker and host processes in the same authoritative worktree', () => {
    const result = snapshot([container()], [host()])
    expect(result.worktrees).toHaveLength(1)
    expect(result.worktrees[0]!.endpoints).toHaveLength(2)
    expect(result.worktrees[0]!.endpoints.find(e => e.logicalPort === 4000)).toMatchObject({
      transports: ['http'],
      target: { address: '127.0.0.1', port: 49100 },
    })
  })
  it('keeps different repos with the same branch distinct', () => {
    const other = container()
    other.context!.repo = '/private/repos/other'
    other.id = 'container-two'
    const result = snapshot([container(), other], [host()])
    expect(result.worktrees).toHaveLength(2)
    expect(new Set(result.worktrees.map(w => w.worktreeId)).size).toBe(2)
    expect(result.worktrees.every(w => w.namespace === 'feature-one.port')).toBe(true)
  })
  it('keeps IDs independent of revision, input order, target port and PID', () => {
    const before = snapshot([container()], [host()])
    const after = buildRemoteSnapshot({
      instanceId: 'machine-1',
      revision: 8,
      docker: [container()],
      hosts: [{ ...host(), pid: 456, actualPort: 49101 }],
    })
    expect(after.revision).toBe(8)
    expect(after.worktrees[0]!.worktreeId).toBe(before.worktrees[0]!.worktreeId)
    expect(after.worktrees[0]!.endpoints.map(e => e.id)).toEqual(
      before.worktrees[0]!.endpoints.map(e => e.id)
    )
    const second = { ...host(), repo: '/another' }
    expect(snapshot([], [host(), second])).toEqual(snapshot([], [second, host()]))
  })
  it('ignores unrelated containers, stopped sources, and missing network addresses', () => {
    expect(
      snapshot(
        [
          { ...container(), stateRunning: false },
          { ...container(), networks: { default: { IPAddress: '10.1.2.3' } } },
          { ...container(), networks: { 'traefik-network': { IPAddress: '' } } },
          { id: 'other', stateRunning: true, labels: { unrelated: 'yes' }, networks: {} },
        ],
        [{ ...host(), running: false }]
      ).worktrees
    ).toEqual([])
  })
  it.each([
    '8.8.8.8',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    'localhost',
    '10.0.0.01',
    '::1',
    'http://127.0.0.1',
  ])('rejects unsafe target %s', address => {
    const source = container()
    source.networks['traefik-network']!.IPAddress = address
    expect(() => snapshot([source])).toThrow('Invalid remote snapshot metadata')
  })
  it.each(['10.2.3.4', '127.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.2'])(
    'accepts private target %s',
    address => {
      const source = container()
      source.networks['traefik-network']!.IPAddress = address
      expect(snapshot([source]).worktrees[0]!.endpoints[0]!.target.address).toBe(address)
    }
  )
  it.each([
    [
      'traefik.http.routers.feature-one-api-8080.rule',
      'Host(`feature-one.port`) || Host(`evil.port`)',
    ],
    ['traefik.tcp.routers.feature-one-api-8080.rule', 'HostSNI(`*`)'],
    ['traefik.http.routers.feature-one-api-8080.rule', 'Host(`another.port`)'],
    ['traefik.http.routers.feature-one-api-8080.entrypoints', 'port8080,web'],
    ['traefik.http.routers.feature-one-api-8080.entrypoints', 'port0'],
    ['traefik.http.services.feature-one-api-8080.loadbalancer.server.port', '65536'],
    ['traefik.http.services.feature-one-api-8080.loadbalancer.server.port', 'http://evil'],
    ['traefik.tcp.services.feature-one-api-8080.loadbalancer.server.port', '3001'],
    ['traefik.tcp.routers.feature-one-api-8080.tls', 'false'],
    ['traefik.http.routers.feature-one-api-8080.middlewares', 'rewrite'],
    ['traefik.http.services.feature-one-api-8080.loadbalancer.server.url', 'http://8.8.8.8'],
    ['traefik.http.services.feature-one-api-alias.loadbalancer.server.port', '9999'],
  ])('rejects changed router semantics %s', (key, value) => {
    const source = container()
    source.labels[key] = value
    expect(() => snapshot([container(), source], [host()])).toThrow()
  })
  it('requires authoritative context and complete generated router metadata', () => {
    const source = container()
    delete source.context
    expect(() => snapshot([source])).toThrow()
    const incomplete = container()
    delete incomplete.labels['traefik.http.routers.feature-one-api-8080.service']
    expect(() => snapshot([incomplete])).toThrow()
  })
  it('advertises only transports actually present, without guessing by well-known port', () => {
    const source = container()
    for (const key of Object.keys(source.labels))
      if (key.startsWith('traefik.tcp.')) delete source.labels[key]
    expect(snapshot([source]).worktrees[0]!.endpoints[0]!.transports).toEqual(['http'])
    const tcp = container()
    for (const key of Object.keys(tcp.labels))
      if (key.startsWith('traefik.http.')) delete tcp.labels[key]
    const endpoint = snapshot([tcp]).worktrees[0]!.endpoints[0]!
    expect(endpoint.transports).toEqual(['tls-sni'])
    expect(endpoint.name).toBeUndefined()
  })
  it('attaches the alias only to the primary port of a multi-port service', () => {
    const source = container()
    for (const [key, value] of Object.entries(source.labels)) {
      if (!key.includes('-8080')) continue
      source.labels[key.replaceAll('-8080', '-9090')] = value
        .replaceAll('-8080', '-9090')
        .replace('port8080', 'port9090')
        .replace('3000', '9000')
    }
    const endpoints = snapshot([source]).worktrees[0]!.endpoints
    expect(endpoints).toHaveLength(2)
    expect(endpoints.find(endpoint => endpoint.logicalPort === 8080)!.name).toBe('api')
    expect(endpoints.find(endpoint => endpoint.logicalPort === 9090)).toMatchObject({
      transports: ['http', 'tls-sni'],
      target: { address: '172.18.0.2', port: 9000 },
    })
    expect(endpoints.find(endpoint => endpoint.logicalPort === 9090)!.name).toBeUndefined()
  })
  it('rejects malformed context DNS and oversized projected metadata', () => {
    expect(() => snapshot([], [{ ...host(), domain: 'bad..port' }])).toThrow()
    const source = container()
    source.labels.extra = 'x'.repeat(4097)
    expect(() => snapshot([source])).toThrow()
    const tooMany = container()
    for (let i = 0; i < 513; i++) tooMany.labels[`extra-${i}`] = ''
    expect(() => snapshot([tooMany])).toThrow()
  })
  it('rejects ambiguous alias-to-primary mapping rather than choosing a published port', () => {
    const source = container()
    for (const [key, value] of Object.entries(source.labels)) {
      if (!key.includes('-8080')) continue
      source.labels[key.replaceAll('-8080', '-8081')] = value
        .replaceAll('-8080', '-8081')
        .replace('port8080', 'port8081')
    }
    expect(() => snapshot([source])).toThrow()
  })
  it('validates bounds, host ports and revisions', () => {
    expect(() => snapshot(Array.from({ length: 1025 }, container))).toThrow()
    expect(() => snapshot([], [{ ...host(), logicalPort: 0 }])).toThrow()
    expect(() => snapshot([], [{ ...host(), actualPort: 65536 }])).toThrow()
    expect(() => snapshot([], [{ ...host(), pid: NaN }])).toThrow()
    expect(() => snapshot([], [{ ...host(), repo: 'x'.repeat(4097) }])).toThrow()
    expect(() =>
      buildRemoteSnapshot({ instanceId: 'id', revision: -1, docker: [], hosts: [] })
    ).toThrow()
    expect(() =>
      buildRemoteSnapshot({ instanceId: 'id', revision: 1.5, docker: [], hosts: [] })
    ).toThrow()
  })
  it('deduplicates exact repeats, rejects contradictory repeats, and returns detached data', () => {
    const source = container()
    const one = snapshot([source])
    expect(snapshot([source, source])).toEqual(one)
    expect(() => snapshot([], [host(), { ...host(), actualPort: 49101 }])).toThrow()
    source.networks['traefik-network']!.IPAddress = '10.0.0.2'
    expect(one.worktrees[0]!.endpoints[0]!.target.address).toBe('172.18.0.2')
  })
})

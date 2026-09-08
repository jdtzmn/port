import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { renderRemoteRouteConfig } from './remoteRouteConfig.ts'
import {
  compileRemoteRoutePlan,
  type RemoteRoutePlan,
  type RemoteRouteSource,
} from './remoteRoutePlan.ts'

const source = (id = 'remote', logicalPort = 3000, name = 'ui'): RemoteRouteSource => ({
  owner: { id, kind: id === 'local' ? 'local' : 'ssh', label: id },
  ...(id === 'local' ? {} : { alias: id }),
  snapshot: {
    version: 1,
    kind: 'port-service-snapshot',
    instanceId: 'not-owner',
    revision: 1,
    worktrees: [
      {
        worktreeId: `${id}-wt`,
        namespace: 'feature.port',
        endpoints: [
          {
            id: 'opaque-endpoint',
            name,
            logicalPort,
            transports: ['http', 'tls-sni'],
            aliasTransports: ['http'],
            target: { address: '10.99.99.99', port: 49999 },
          },
        ],
      },
    ],
  },
})
const target = { address: '127.0.0.1', port: 41000 }
const guardTarget = { address: '172.20.0.2', port: 42000 }
type Options = Parameters<typeof renderRemoteRouteConfig>[1]
const options = () => ({
  backend: vi.fn<Options['backend']>(() => target),
  guard: vi.fn<Options['guard']>(() => guardTarget),
})
const plans = () => compileRemoteRoutePlan([source()])
const error = 'Invalid remote route config'
type Router = {
  rule: string
  service: string
  entryPoints: string[]
  priority: number
  tls?: object
}
type Config = Record<
  'http' | 'tcp',
  {
    routers: Record<string, Router>
    services: Record<
      string,
      { loadBalancer: { passHostHeader?: boolean; servers: { url?: string; address?: string }[] } }
    >
  }
>
const decode = (content: string): Config => parse(content) as Config

describe('renderRemoteRouteConfig', () => {
  it('renders compiled HTTP, TLS and aliases with exact rules, private lookup targets and original entrypoints', () => {
    const input = plans()
    const opts = options()
    const result = renderRemoteRouteConfig(input, opts)
    const config = decode(result.content)
    expect(result.ports).toEqual([3000])
    expect(Object.keys(config.http.routers)).toHaveLength(4)
    expect(Object.keys(config.tcp.routers)).toHaveLength(2)
    const names = new Set<string>()
    for (const plan of input) {
      const http = plan.transport === 'http'
      const section = http ? config.http : config.tcp
      const rule = `${http ? 'Host' : 'HostSNI'}(\`${plan.hostname}\`)`
      const match = Object.entries(section.routers).find(
        ([, router]) =>
          router.rule === rule &&
          router.entryPoints[0] === (plan.port === 80 ? 'web' : `port${plan.port}`)
      )!
      const [name, router] = match
      expect(name).toMatch(/^port-remote-[a-f0-9]{64}$/)
      expect(names.has(name)).toBe(false)
      names.add(name)
      expect(router.priority).toBe(100000)
      expect(router.priority).toBeGreaterThan(rule.length) // Generated Docker rules use implicit rule length.
      expect(router.service).toBe(name)
      expect(router.tls).toEqual(http ? undefined : {})
      expect(section.services[name]!.loadBalancer).toEqual(
        http
          ? { passHostHeader: true, servers: [{ url: 'http://127.0.0.1:41000' }] }
          : { servers: [{ address: '127.0.0.1:41000' }] }
      )
      expect(
        opts.backend.mock.calls.some(
          ([ref, transport]) => ref === plan.endpoint && transport === plan.transport
        )
      ).toBe(true)
    }
    expect(opts.guard).not.toHaveBeenCalled()
    expect(result.content).not.toContain('10.99.99.99')
    expect(result.content).not.toContain('49999')
  })

  it('keeps conflicting and explicitly missing services guarded without endpoint lookup or local fallback', () => {
    const input = compileRemoteRoutePlan([source(), source('local', 5432, 'db')])
    const opts = options()
    const config = decode(renderRemoteRouteConfig(input, opts).content)
    const unresolved = input.filter(p => p.resolution.status !== 'resolved')
    expect(unresolved.some(p => p.resolution.status === 'conflict')).toBe(true)
    expect(
      unresolved.some(
        p => p.hostname === 'ui.feature.local.port' && p.resolution.status === 'unavailable'
      )
    ).toBe(true)
    expect(opts.backend).toHaveBeenCalledTimes(input.length - unresolved.length)
    expect(opts.guard).toHaveBeenCalledTimes(unresolved.length)
    for (const plan of unresolved) {
      expect(opts.guard).toHaveBeenCalledWith(plan, plan.resolution.status)
      const section = plan.transport === 'http' ? config.http : config.tcp
      const router = Object.values(section.routers).find(
        r =>
          r.rule.endsWith(`(\`${plan.hostname}\`)`) &&
          r.entryPoints[0] === (plan.port === 80 ? 'web' : `port${plan.port}`)
      )!
      expect(router.priority).toBe(100000)
      expect(section.services[router.service]!.loadBalancer.servers).toEqual(
        plan.transport === 'http'
          ? [{ url: 'http://172.20.0.2:42000' }]
          : [{ address: '172.20.0.2:42000' }]
      )
    }
    const onlyGuards = options()
    renderRemoteRouteConfig(unresolved, onlyGuards)
    expect(onlyGuards.backend).not.toHaveBeenCalled()
  })

  it('guards resolved routes whose ready backend is missing', () => {
    const input = plans()
    const opts = { backend: vi.fn(() => undefined), guard: vi.fn(() => guardTarget) }
    const config = decode(renderRemoteRouteConfig(input, opts).content)
    expect(Object.keys(config.http.routers).length + Object.keys(config.tcp.routers).length).toBe(
      input.length
    )
    for (const plan of input) expect(opts.guard).toHaveBeenCalledWith(plan, 'unavailable')
    expect(opts.backend).toHaveBeenCalledTimes(input.length)
  })

  it('is stable across input/source ordering and backend/ownership changes', () => {
    const input = compileRemoteRoutePlan([source(), source('local', 8080, 'api')])
    const before = structuredClone(input)
    const result = renderRemoteRouteConfig(input, options())
    expect(renderRemoteRouteConfig([...input].reverse(), options())).toEqual(result)
    expect(
      renderRemoteRouteConfig(
        compileRemoteRoutePlan([source('local', 8080, 'api'), source()]),
        options()
      )
    ).toEqual(result)
    expect(input).toEqual(before)
    const changed = decode(
      renderRemoteRouteConfig(input, {
        backend: () => ({ address: '10.0.0.2', port: 1 }),
        guard: () => target,
      }).content
    )
    const original = decode(result.content)
    for (const protocol of ['http', 'tcp'] as const)
      expect(changed[protocol].routers).toEqual(original[protocol].routers)
    const shared = plans().find(p => p.hostname === 'feature.port' && p.transport === 'http')!
    const conflicted = input.find(
      p =>
        p.hostname === shared.hostname && p.port === shared.port && p.transport === shared.transport
    )!
    expect(decode(renderRemoteRouteConfig([shared], options()).content).http.routers).toEqual(
      decode(renderRemoteRouteConfig([conflicted], options()).content).http.routers
    )
  })

  it('uses web for both transports on port 80, deduplicates and numerically sorts other ports', () => {
    const a = source('remote', 80)
    a.snapshot.worktrees[0]!.endpoints.push(
      { ...a.snapshot.worktrees[0]!.endpoints[0]!, id: 'second', name: 'api', logicalPort: 9000 },
      { ...a.snapshot.worktrees[0]!.endpoints[0]!, id: 'third', name: 'db', logicalPort: 443 }
    )
    const result = renderRemoteRouteConfig(compileRemoteRoutePlan([a]), options())
    expect(result.ports).toEqual([443, 9000])
    const config = decode(result.content)
    expect(Object.values(config.tcp.routers).filter(r => r.entryPoints[0] === 'web')).toHaveLength(
      2
    )
    expect(result.content).not.toContain('port80')
  })

  it('renders empty sections without lookups', () => {
    const opts = options()
    const result = renderRemoteRouteConfig([], opts)
    expect(decode(result.content)).toEqual({
      http: { routers: {}, services: {} },
      tcp: { routers: {}, services: {} },
    })
    expect(result.ports).toEqual([])
    expect(opts.backend).not.toHaveBeenCalled()
    expect(opts.guard).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { resolution: { status: 'invalid' } },
    { resolution: { status: 'unknown' } },
    { endpoint: undefined },
    { transport: 'tcp' },
    { transport: 'tls-sni' },
    { port: 0 },
    { port: 65536 },
    { port: 1.5 },
    { port: '80' },
    { port: NaN },
    { hostname: 'foo`) || Host(`evil.port' },
    { hostname: 'UPPER.port' },
    { hostname: 'feature.port\n' },
    { hostname: 'feature\n.port' },
    { hostname: 'a..port' },
    { hostname: '-bad.port' },
    { hostname: 'a'.repeat(64) + '.port' },
    { hostname: '127.0.0.1' },
    { hostname: 'https://feature.port' },
    { hostname: 'x.'.repeat(127) + 'port' },
    { endpoint: { ownerId: 'wrong', worktreeId: 'remote-wt', endpointId: 'opaque-endpoint' } },
    { resolution: { status: 'conflict', candidates: [] }, endpoint: undefined },
  ])('preflights all malformed plans before callbacks: %j', patch => {
    const good = plans().find(p => p.transport === 'http')!
    const bad = patch === null ? null : Object.keys(patch).length ? { ...good, ...patch } : {}
    const opts = options()
    expect(() => renderRemoteRouteConfig([good, bad] as RemoteRoutePlan[], opts)).toThrow(error)
    expect(opts.backend).not.toHaveBeenCalled()
    expect(opts.guard).not.toHaveBeenCalled()
  })

  it('rejects duplicates and oversized batches before callbacks', () => {
    const good = plans()[0]!
    for (const input of [
      [good, structuredClone(good)],
      Array.from({ length: 4097 }, () => good),
      new Array<RemoteRoutePlan>(1),
    ]) {
      const opts = options()
      expect(() => renderRemoteRouteConfig(input, opts)).toThrow(error)
      expect(opts.backend).not.toHaveBeenCalled()
      expect(opts.guard).not.toHaveBeenCalled()
    }
  })

  it.each([
    { address: '8.8.8.8', port: 80 },
    { address: 'https://10.0.0.1', port: 80 },
    { address: 'localhost', port: 80 },
    { address: '10.0.0.1:80', port: 80 },
    { address: '169.254.169.254', port: 80 },
    { address: '172.32.0.1', port: 80 },
    { address: '172.15.0.1', port: 80 },
    { address: '192.169.0.1', port: 80 },
    { address: '::1', port: 80 },
    { address: '0.0.0.0', port: 80 },
    { address: '127.00.0.1', port: 80 },
    { address: '127.0.0.1\n', port: 80 },
    { address: '10.0.0.1', port: 0 },
    { address: '10.0.0.1', port: 65536 },
    { address: '10.0.0.1', port: 1.5 },
    { address: '10.0.0.1', port: '80/path' },
    null,
    {},
  ])('rejects unsafe backend and guard targets with fixed errors: %j', unsafe => {
    for (const transport of ['http', 'tls-sni'] as const) {
      const input = plans().filter(p => p.transport === transport)
      const bad = unsafe as typeof target
      expect(() =>
        renderRemoteRouteConfig(input, { backend: () => bad, guard: () => guardTarget })
      ).toThrow(error)
      expect(() =>
        renderRemoteRouteConfig(input, { backend: () => undefined, guard: () => bad })
      ).toThrow(error)
    }
  })

  it.each(['10.0.0.1', '127.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1'])(
    'accepts private and loopback IPv4 %s',
    address => {
      expect(() =>
        renderRemoteRouteConfig(plans(), {
          backend: () => ({ address, port: 65535 }),
          guard: () => guardTarget,
        })
      ).not.toThrow()
    }
  )

  it('sanitizes callback failures and undefined guard targets', () => {
    expect(() =>
      renderRemoteRouteConfig(plans(), {
        backend: () => {
          throw new Error('sensitive target')
        },
        guard: () => guardTarget,
      })
    ).toThrow(error)
    expect(() =>
      renderRemoteRouteConfig(plans(), {
        backend: () => undefined,
        guard: () => undefined as unknown as typeof target,
      })
    ).toThrow(error)
  })
})

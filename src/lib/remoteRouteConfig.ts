import { createHash } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { stringify as yamlStringify } from 'yaml'
import type { RemoteRoutePlan } from './remoteRoutePlan.ts'

type Target = { address: string; port: number }
type Options = {
  /** Pure lookup of already-ready local/relay resources; never create resources here. */
  backend: (
    ref: NonNullable<RemoteRoutePlan['endpoint']>,
    transport: 'http' | 'tls-sni'
  ) => Target | undefined
  /** Pure lookup of an already-ready fail-closed guard. */
  guard: (plan: RemoteRoutePlan, status: 'conflict' | 'unavailable') => Target
}

const fail = (): never => {
  throw new Error('Invalid remote route config')
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const port = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535
const hostname = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 253 &&
  !/\s/.test(v) &&
  v.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(v)
const owner = (v: unknown): boolean =>
  object(v) && text(v.id) && text(v.label) && (v.kind === 'local' || v.kind === 'ssh')
const service = (v: unknown): boolean =>
  object(v) &&
  text(v.id) &&
  port(v.logicalPort) &&
  (v.name === undefined || text(v.name)) &&
  (v.protocol === 'http' || v.protocol === 'tcp')

function validPlan(v: unknown): v is RemoteRoutePlan {
  if (
    !object(v) ||
    !hostname(v.hostname) ||
    !port(v.port) ||
    (v.transport !== 'http' && v.transport !== 'tls-sni') ||
    !object(v.resolution)
  )
    return false
  const r = v.resolution
  if (r.status === 'resolved') {
    const ref = v.endpoint
    return (
      owner(r.owner) &&
      object(r.owner) &&
      text(r.worktreeId) &&
      service(r.service) &&
      object(r.service) &&
      r.service.protocol === (v.transport === 'http' ? 'http' : 'tcp') &&
      object(ref) &&
      text(ref.ownerId) &&
      text(ref.worktreeId) &&
      text(ref.endpointId) &&
      ref.ownerId === r.owner.id &&
      ref.worktreeId === r.worktreeId
    )
  }
  if (v.endpoint !== undefined) return false
  if (r.status === 'unavailable') return true
  return (
    r.status === 'conflict' &&
    Array.isArray(r.candidates) &&
    r.candidates.length > 0 &&
    r.candidates.length <= 4096 &&
    Array.from(r.candidates).every(
      c =>
        object(c) &&
        owner(c.owner) &&
        text(c.worktreeId) &&
        Array.isArray(c.services) &&
        c.services.length <= 4096 &&
        Array.from(c.services).every(service)
    )
  )
}

function checkedTarget(v: unknown): Target {
  if (!object(v) || typeof v.address !== 'string' || !isIPv4(v.address) || !port(v.port))
    return fail()
  const [a, b] = v.address.split('.').map(Number)
  if (!(a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)))
    return fail()
  return { address: v.address, port: v.port }
}

/**
 * Render only coordinator-provided, ready private IPv4 targets, never snapshot targets.
 * Consumers MUST write this YAML to a .yml/.yaml file: Traefik rejects .json files.
 * Priority 100000 beats Port's generated Docker rules (implicit rule-length priority),
 * not arbitrary user-custom priorities. TLS-SNI terminates TLS, like existing Port.
 */
export function renderRemoteRouteConfig(
  plans: readonly RemoteRoutePlan[],
  options: Options
): { content: string; ports: number[] } {
  // Preflight the entire input before any lookup, even though callbacks must be pure.
  if (!Array.isArray(plans) || plans.length > 4096 || !Array.from(plans).every(validPlan))
    return fail()
  const keyed = plans.map(plan => ({
    plan,
    key: JSON.stringify([plan.hostname, plan.port, plan.transport]),
  }))
  if (new Set(keyed.map(({ key }) => key)).size !== keyed.length) return fail()
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const http = { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown> }
  const tcp = { routers: {} as Record<string, unknown>, services: {} as Record<string, unknown> }
  const ports = new Set<number>()
  try {
    for (const { plan, key } of keyed) {
      const status = plan.resolution.status
      const ready =
        status === 'resolved' ? options.backend(plan.endpoint!, plan.transport) : undefined
      const target = checkedTarget(
        ready === undefined
          ? options.guard(plan, status === 'conflict' ? 'conflict' : 'unavailable')
          : ready
      )
      const name = `port-remote-${createHash('sha256').update(key).digest('hex')}`
      const isHttp = plan.transport === 'http'
      const section = isHttp ? http : tcp
      section.routers[name] = {
        rule: `${isHttp ? 'Host' : 'HostSNI'}(\`${plan.hostname}\`)`,
        entryPoints: [plan.port === 80 ? 'web' : `port${plan.port}`],
        priority: 100000,
        service: name,
        ...(isHttp ? {} : { tls: {} }),
      }
      section.services[name] = {
        loadBalancer: isHttp
          ? { passHostHeader: true, servers: [{ url: `http://${target.address}:${target.port}` }] }
          : { servers: [{ address: `${target.address}:${target.port}` }] },
      }
      if (plan.port !== 80) ports.add(plan.port)
    }
    return { content: yamlStringify({ http, tcp }), ports: [...ports].sort((a, b) => a - b) }
  } catch {
    return fail()
  }
}

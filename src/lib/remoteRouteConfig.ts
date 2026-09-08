import { createHash, X509Certificate } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { stringify as yamlStringify } from 'yaml'
import type { RemoteRoutePlan } from './remoteRoutePlan.ts'

type Target = {
  address: string
  port: number
  tls: { serverName: string; certificatePem: string }
}
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
  if (!object(v.tls) || !hostname(v.tls.serverName)) return fail()
  const { serverName, certificatePem } = v.tls
  // Exactly one bounded public certificate; never accept paths, chains or private keys.
  if (
    typeof certificatePem !== 'string' ||
    Buffer.byteLength(certificatePem) > 16 * 1024 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\r?\n?$/.test(
      certificatePem
    )
  )
    return fail()
  const certificate = new X509Certificate(certificatePem)
  const startsAt = Date.parse(certificate.validFrom)
  const expiresAt = Date.parse(certificate.validTo)
  const now = Date.now()
  if (
    certificate.checkHost(serverName, { subject: 'never', wildcards: false }) !== serverName ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(expiresAt) ||
    startsAt > now ||
    expiresAt <= now ||
    certificate.subject !== certificate.issuer ||
    !certificate.verify(certificate.publicKey)
  )
    return fail()
  return { address: v.address, port: v.port, tls: { serverName, certificatePem } }
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
  const section = () => ({
    routers: {} as Record<string, unknown>,
    services: {} as Record<string, unknown>,
    serversTransports: {} as Record<string, unknown>,
  })
  const http = section()
  const tcp = section()
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
      // Rotate connection pools with the trust incarnation, not merely the route hostname.
      const transportName = `port-remote-transport-${createHash('sha256')
        .update(JSON.stringify([key, target.tls.serverName, target.tls.certificatePem]))
        .digest('hex')}`
      const tls = {
        serverName: target.tls.serverName,
        rootCAs: [target.tls.certificatePem],
        insecureSkipVerify: false,
      }
      section.serversTransports[transportName] = isHttp ? { ...tls, disableHTTP2: true } : { tls }
      section.services[name] = {
        loadBalancer: {
          serversTransport: transportName,
          ...(isHttp
            ? {
                passHostHeader: true,
                servers: [{ url: `https://${target.address}:${target.port}` }],
              }
            : { servers: [{ address: `${target.address}:${target.port}`, tls: true }] }),
        },
      }
      if (plan.port !== 80) ports.add(plan.port)
    }
    return { content: yamlStringify({ http, tcp }), ports: [...ports].sort((a, b) => a - b) }
  } catch {
    return fail()
  }
}

import type { RemoteSnapshot, RemoteTransport } from './remoteSnapshot.ts'
import {
  createRouteResolver,
  type RouteOwner,
  type RouteRequest,
  type RouteResolution,
  type RouteService,
  type WorktreeRoutes,
} from './routeOwnership.ts'

export interface RemoteRouteSource {
  /** Trusted coordinator identity; never inferred from snapshot.instanceId. */
  owner: RouteOwner
  /** Canonical DNS label(s) allocated by the trusted coordinator. */
  alias?: string
  snapshot: RemoteSnapshot
}

export interface RemoteRoutePlan {
  hostname: string
  port: number
  transport: RemoteTransport
  resolution: RouteResolution
  endpoint?: { ownerId: string; worktreeId: string; endpointId: string }
}

const LIMIT = 4096
const fail = (): never => {
  throw new Error('Invalid remote route plan metadata')
}
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const label = (value: string): boolean => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
const dns = (value: string): boolean =>
  typeof value === 'string' &&
  value.length <= 253 &&
  value.split('.').every(label) &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(value)
const identity = (ownerId: string, worktreeId: string, serviceId: string): string =>
  JSON.stringify([ownerId, worktreeId, serviceId])

/**
 * Compile validated snapshot DTOs, without network, lease, or renderer side effects.
 * The legacy resolver's `tcp` capability means TLS-SNI here, NOT plaintext TCP.
 * Repeated owner sources are rejected; the coordinator must coalesce them first.
 * Unavailable qualified entries are intentional guards, not routes to omit/fallback.
 */
export function compileRemoteRoutePlan(
  sources: readonly RemoteRouteSource[],
  domain = 'port'
): RemoteRoutePlan[] {
  if (!dns(domain) || sources.length > LIMIT) return fail()
  const records: WorktreeRoutes[] = []
  const owners = new Map<string, string>()
  const qualifiers = new Set<string>()
  const references = new Map<string, string>()
  const namespaces = new Map<string, { branch: string; selectors: Map<string, RouteRequest> }>()
  let endpointCount = 0
  let worktreeCount = 0

  for (const { owner, alias, snapshot } of sources) {
    if (
      !owner.id?.trim() ||
      !owner.label?.trim() ||
      (owner.kind !== 'local' && owner.kind !== 'ssh') ||
      owners.has(owner.id) ||
      (owner.kind === 'local' && alias !== undefined) ||
      (owner.kind === 'ssh' && (alias === undefined || !dns(alias)))
    )
      return fail()
    const qualifier = owner.kind === 'local' ? `local.${domain}` : `${alias}.ssh`
    if (!dns(qualifier) || qualifiers.has(qualifier)) return fail()
    owners.set(owner.id, qualifier)
    qualifiers.add(qualifier)

    for (const worktree of snapshot.worktrees) {
      if (++worktreeCount > LIMIT) return fail()
      const { namespace } = worktree
      const suffix = `.${domain}`
      const branch = namespace.endsWith(suffix) ? namespace.slice(0, -suffix.length) : ''
      if (!label(branch) || !dns(namespace)) return fail()
      const known = namespaces.get(namespace) ?? {
        branch,
        selectors: new Map<string, RouteRequest>(),
      }
      namespaces.set(namespace, known)
      const record: WorktreeRoutes = {
        owner,
        namespace,
        worktreeId: worktree.worktreeId,
        services: [],
      }
      const services: RouteService[] = []
      for (const endpoint of worktree.endpoints) {
        if (++endpointCount > LIMIT) return fail()
        for (const transport of endpoint.transports) {
          const protocol = transport === 'http' ? 'http' : 'tcp'
          const serviceId = `${endpoint.id}-${transport}`
          const key = identity(owner.id, worktree.worktreeId, serviceId)
          if (references.has(key)) return fail()
          references.set(key, endpoint.id)
          services.push({
            id: serviceId,
            logicalPort: endpoint.logicalPort,
            protocol,
            ...(transport === 'http' && endpoint.name ? { name: endpoint.name } : {}),
          })
          const request: RouteRequest = {
            namespace,
            protocol,
            service: { port: endpoint.logicalPort },
          }
          known.selectors.set(JSON.stringify(request), request)
          if (transport === 'http' && endpoint.name) {
            if (!label(endpoint.name)) return fail()
            const named: RouteRequest = { namespace, protocol, service: { name: endpoint.name } }
            known.selectors.set(JSON.stringify(named), named)
          }
        }
      }
      record.services = services
      records.push(record)
    }
  }

  const resolve = createRouteResolver(records)
  const plans = new Map<string, { requestKey: string; plan: RemoteRoutePlan }>()
  function add(hostname: string, request: RouteRequest): void {
    if (!dns(hostname)) return fail()
    const transport = request.protocol === 'http' ? 'http' : 'tls-sni'
    const port = 'port' in request.service ? request.service.port : 80
    const key = JSON.stringify([hostname, port, transport])
    const requestKey = JSON.stringify(request)
    const previous = plans.get(key)
    if (previous) {
      if (previous.requestKey !== requestKey) return fail()
      return
    }
    if (plans.size >= LIMIT) return fail()
    const resolution = resolve(request)
    if (resolution.status === 'invalid') return fail()
    const plan: RemoteRoutePlan = { hostname, port, transport, resolution }
    if (resolution.status === 'resolved') {
      const { owner, worktreeId, service } = resolution
      const endpointId = references.get(identity(owner.id, worktreeId, service.id))
      if (!endpointId) return fail()
      plan.endpoint = { ownerId: owner.id, worktreeId, endpointId }
    }
    plans.set(key, { requestKey, plan })
  }

  for (const [namespace, { branch, selectors }] of namespaces) {
    for (const request of selectors.values()) {
      const prefix = 'name' in request.service ? `${request.service.name}.` : ''
      add(`${prefix}${namespace}`, request)
      // Include absent owners too: explicit qualification must never fall back.
      for (const [ownerId, qualifier] of owners) {
        add(`${prefix}${branch}.${qualifier}`, { ...request, ownerId })
      }
    }
  }
  return [...plans.values()]
    .map(({ plan }) => plan)
    .sort(
      (a, b) =>
        compare(a.hostname, b.hostname) || a.port - b.port || compare(a.transport, b.transport)
    )
}

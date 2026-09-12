import type { RemoteReconcilerSource, RemoteRouteBackendRef } from './reconciler.ts'
import { compileRemoteRoutePlan } from './plan.ts'

const LIMIT = 4096
const fail = (): never => {
  throw new Error('Invalid remote route snapshot')
}
const label = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
const hostname = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 253 &&
  value.split('.').every(label) &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(value)
const port = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535

type Availability = 'ready' | 'unavailable' | 'conflict'

export interface RemoteRouteAddress {
  /** Canonical worktree namespace, used only for local CLI scoping. */
  namespace: string
  hostname: string
  port: number
  transport: 'http' | 'tls-sni'
  availability: Availability
  serviceName?: string
  alternatives?: { alias: string; hostname: string; port: number }[]
}

/** Durable, local-CLI-safe view. It deliberately excludes targets, paths, IDs and SSH metadata. */
export interface RemoteRouteSnapshot {
  version: 1
  routes: RemoteRouteAddress[]
}

function alias(owner: { kind: 'local' | 'ssh'; label: string }, value?: string): string {
  if (owner.kind === 'local') return 'local'
  if (!value || !hostname(value)) return fail()
  return value
}

export function buildRemoteRouteSnapshot(
  sources: readonly RemoteReconcilerSource[],
  readyBackends?: readonly RemoteRouteBackendRef[]
): RemoteRouteSnapshot {
  const ready = readyBackends
    ? new Set(
        readyBackends.map(endpoint =>
          JSON.stringify([endpoint.ownerId, endpoint.worktreeId, endpoint.endpointId])
        )
      )
    : undefined
  if (sources.length > LIMIT) return fail()
  const owners = new Map<
    string,
    { kind: 'local' | 'ssh'; label: string; alias?: string; available: boolean }
  >()
  for (const source of sources) {
    if (owners.has(source.owner.id)) return fail()
    owners.set(source.owner.id, {
      ...source.owner,
      alias: source.alias,
      available: source.available,
    })
  }
  const routes = compileRemoteRoutePlan(sources).map(plan => {
    let availability: Availability
    if (plan.resolution.status === 'conflict') availability = 'conflict'
    else if (plan.resolution.status === 'unavailable') availability = 'unavailable'
    else if (plan.resolution.status === 'resolved') {
      const owner = owners.get(plan.resolution.owner.id)
      const endpoint = plan.endpoint
      availability =
        owner?.available &&
        (!ready ||
          (endpoint !== undefined &&
            ready.has(
              JSON.stringify([endpoint.ownerId, endpoint.worktreeId, endpoint.endpointId])
            )))
          ? 'ready'
          : 'unavailable'
    } else {
      return fail()
    }
    const route: RemoteRouteAddress = {
      namespace: plan.namespace,
      hostname: plan.hostname,
      port: plan.port,
      transport: plan.transport,
      availability,
    }
    if (plan.serviceName) route.serviceName = plan.serviceName
    if (plan.alternatives) {
      route.alternatives = plan.alternatives.map(alternative => {
        const owner = owners.get(alternative.owner.id)
        if (!owner) return fail()
        return {
          alias: alias(owner, owner.alias),
          hostname: alternative.hostname,
          port: alternative.port,
        }
      })
    }
    return route
  })
  return parseRemoteRouteSnapshot(JSON.stringify({ version: 1, routes }))
}

/** Parse only the sanitized, bounded state consumed by local display commands. */
export function parseRemoteRouteSnapshot(encoded: string): RemoteRouteSnapshot {
  if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) return fail()
  let value: unknown
  try {
    value = JSON.parse(encoded)
  } catch {
    return fail()
  }
  const data = value as RemoteRouteSnapshot
  if (!data || Object.keys(data).sort().join(',') !== 'routes,version' || data.version !== 1)
    return fail()
  if (!Array.isArray(data.routes) || data.routes.length > LIMIT) return fail()
  const keys = new Set<string>()
  const routes = data.routes.map(route => {
    if (
      !route ||
      !hostname(route.namespace) ||
      !hostname(route.hostname) ||
      !port(route.port) ||
      (route.transport !== 'http' && route.transport !== 'tls-sni') ||
      !['ready', 'unavailable', 'conflict'].includes(route.availability) ||
      (route.serviceName !== undefined && !label(route.serviceName))
    )
      return fail()
    const key = JSON.stringify([route.hostname, route.port, route.transport])
    if (keys.has(key)) return fail()
    keys.add(key)
    const result: RemoteRouteAddress = {
      namespace: route.namespace,
      hostname: route.hostname,
      port: route.port,
      transport: route.transport,
      availability: route.availability,
    }
    if (route.serviceName !== undefined) result.serviceName = route.serviceName
    if (route.alternatives !== undefined) {
      if (
        route.availability !== 'conflict' ||
        !Array.isArray(route.alternatives) ||
        !route.alternatives.length ||
        route.alternatives.length > LIMIT
      )
        return fail()
      const alternatives = new Set<string>()
      result.alternatives = route.alternatives.map(alternative => {
        if (
          !alternative ||
          !label(alternative.alias) ||
          !hostname(alternative.hostname) ||
          !port(alternative.port)
        )
          return fail()
        const alternativeKey = JSON.stringify([
          alternative.alias,
          alternative.hostname,
          alternative.port,
        ])
        if (alternatives.has(alternativeKey)) return fail()
        alternatives.add(alternativeKey)
        return { ...alternative }
      })
    }
    return result
  })
  return { version: 1, routes }
}

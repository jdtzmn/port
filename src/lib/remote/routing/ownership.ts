export interface RouteOwner {
  id: string
  kind: 'local' | 'ssh'
  label: string
}

/** One endpoint, not a whole Compose service. Alias only the primary port by service name. */
export interface RouteService {
  id: string
  name?: string
  logicalPort: number
  protocol: 'http' | 'tcp'
}

export interface WorktreeRoutes {
  owner: RouteOwner
  worktreeId: string
  namespace: string
  services: readonly RouteService[]
}

export interface RouteRequest {
  namespace: string
  ownerId?: string
  protocol?: RouteService['protocol']
  service: { name: string } | { port: number }
}

export type RouteCandidate = Omit<WorktreeRoutes, 'namespace'>

export type RouteResolution =
  | { status: 'unavailable' }
  | { status: 'invalid' }
  | { status: 'conflict'; candidates: RouteCandidate[] }
  | { status: 'resolved'; owner: RouteOwner; worktreeId: string; service: RouteService }

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const port = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function validRequest(value: unknown): value is RouteRequest {
  if (!object(value) || !text(value.namespace) || !object(value.service)) return false
  if (value.ownerId !== undefined && !text(value.ownerId)) return false
  if (value.protocol !== undefined && value.protocol !== 'http' && value.protocol !== 'tcp')
    return false
  const service = value.service
  return (
    ('name' in service && !('port' in service) && text(service.name)) ||
    ('port' in service && !('name' in service) && port(service.port))
  )
}

/** Validate and copy a record, canonicalizing service order and exact repeats. */
function canonicalRecord(value: unknown): WorktreeRoutes | undefined {
  if (
    !object(value) ||
    !object(value.owner) ||
    !text(value.owner.id) ||
    !text(value.owner.label) ||
    (value.owner.kind !== 'local' && value.owner.kind !== 'ssh') ||
    !text(value.worktreeId) ||
    !text(value.namespace) ||
    !Array.isArray(value.services)
  ) {
    return undefined
  }

  const ids = new Map<string, string>()
  const services = new Map<string, RouteService>()
  for (const service of value.services) {
    if (
      !object(service) ||
      !text(service.id) ||
      (service.name !== undefined && !text(service.name)) ||
      !port(service.logicalPort) ||
      (service.protocol !== 'http' && service.protocol !== 'tcp')
    ) {
      return undefined
    }
    const copy: RouteService = {
      id: service.id,
      name: service.name,
      logicalPort: service.logicalPort,
      protocol: service.protocol,
    }
    const key = JSON.stringify(copy)
    const previous = ids.get(copy.id)
    if (previous !== undefined && previous !== key) return undefined
    ids.set(copy.id, key)
    services.set(key, copy)
  }
  return {
    owner: { id: value.owner.id, kind: value.owner.kind, label: value.owner.label },
    worktreeId: value.worktreeId,
    namespace: value.namespace,
    services: [...services.values()].sort(
      (a, b) => compare(a.name ?? '', b.name ?? '') || compare(a.id, b.id)
    ),
  }
}

/**
 * Pure ownership decision; namespaces are already canonical hostnames.
 * Any malformed record or contradictory repeat invalidates the entire snapshot,
 * including qualified requests. No invalid advertisement is silently discarded.
 * Exact service repeats collapse; owner metadata and complete service sets must
 * agree across repeat sessions. Ownership is chosen before looking for a service.
 * After choosing one owner/worktree, endpoint ambiguity also returns conflict:
 * one candidate containing only matching endpoints. Ownership conflicts instead
 * contain every eligible owner/worktree and their complete endpoint sets.
 * Shared ports/aliases are legal; only the requested selector must be unique.
 * Compile a detached snapshot once; queries scan only the requested namespace
 * and selected worktree's endpoints. Returned objects never alias the index.
 */
export function createRouteResolver(
  records: readonly WorktreeRoutes[]
): (request: RouteRequest) => RouteResolution {
  const invalid = (): RouteResolution => ({ status: 'invalid' })
  if (!Array.isArray(records)) return invalid

  const advertisements = new Map<string, string>()
  const owners = new Map<string, string>()
  const namespaces = new Map<string, RouteCandidate[]>()
  for (const value of records) {
    const record = canonicalRecord(value)
    if (!record) return invalid
    const ownerKey = JSON.stringify(record.owner)
    const previousOwner = owners.get(record.owner.id)
    if (previousOwner !== undefined && previousOwner !== ownerKey) return invalid
    owners.set(record.owner.id, ownerKey)

    const key = JSON.stringify([record.namespace, record.owner.id, record.worktreeId])
    const advertisement = JSON.stringify(record)
    const previous = advertisements.get(key)
    if (previous !== undefined) {
      if (previous !== advertisement) return invalid
      continue
    }
    advertisements.set(key, advertisement)
    const candidates = namespaces.get(record.namespace) ?? []
    candidates.push({
      owner: record.owner,
      worktreeId: record.worktreeId,
      services: record.services,
    })
    namespaces.set(record.namespace, candidates)
  }
  for (const candidates of namespaces.values()) {
    candidates.sort(
      (a, b) => compare(a.owner.id, b.owner.id) || compare(a.worktreeId, b.worktreeId)
    )
  }
  return request => {
    if (!validRequest(request)) return invalid()
    const candidates = namespaces.get(request.namespace) ?? []
    const eligible =
      request.ownerId === undefined
        ? candidates
        : candidates.filter(candidate => candidate.owner.id === request.ownerId)
    return selectRoute(eligible, request.service, request.protocol)
  }
}

function copyCandidate(candidate: RouteCandidate): RouteCandidate {
  return {
    owner: { ...candidate.owner },
    worktreeId: candidate.worktreeId,
    services: candidate.services.map(service => ({ ...service })),
  }
}

function selectRoute(
  candidates: readonly RouteCandidate[],
  selector: RouteRequest['service'],
  protocol?: RouteRequest['protocol']
): RouteResolution {
  if (candidates.length > 1) {
    return { status: 'conflict', candidates: candidates.map(copyCandidate) }
  }
  const candidate = candidates[0]
  if (!candidate) return { status: 'unavailable' }
  const matches = candidate.services.filter(
    service =>
      (protocol === undefined || service.protocol === protocol) &&
      ('name' in selector ? service.name === selector.name : service.logicalPort === selector.port)
  )
  if (matches.length > 1) {
    return { status: 'conflict', candidates: [copyCandidate({ ...candidate, services: matches })] }
  }
  const service = matches[0]
  return service
    ? {
        status: 'resolved',
        owner: { ...candidate.owner },
        worktreeId: candidate.worktreeId,
        service: { ...service },
      }
    : { status: 'unavailable' }
}

/** One-shot convenience; reuse createRouteResolver for repeated queries. */
export function resolveRoute(
  records: readonly WorktreeRoutes[],
  request: RouteRequest
): RouteResolution {
  return createRouteResolver(records)(request)
}

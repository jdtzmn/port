import { createHash } from 'node:crypto'
import { isIPv4 } from 'node:net'
import type { HostService } from '../types.ts'
import { formatHostname } from './hostname.ts'

export interface WorktreeContext {
  repo: string
  branch: string
  domain: string
}

/** Collector-projected metadata only; never pass Docker inspect objects or Env. */
export interface SafeContainer {
  id: string
  stateRunning: boolean
  labels: Record<string, string>
  networks: Record<string, { IPAddress: string }>
  /** Authoritative registry mapping; required for relevant running containers. */
  context?: WorktreeContext
}

export interface SafeHost extends Pick<
  HostService,
  'repo' | 'branch' | 'logicalPort' | 'actualPort' | 'pid'
> {
  running: boolean
  domain: string
}

export type RemoteTransport = 'http' | 'tls-sni'
export interface RemoteEndpoint {
  id: string
  /** Named aliases are HTTP-only, even when the port also supports TLS-SNI. */
  name?: string
  aliasTransports?: ['http']
  logicalPort: number
  transports: RemoteTransport[]
  target: { address: string; port: number }
}
export interface RemoteSnapshot {
  version: 1
  kind: 'port-service-snapshot'
  instanceId: string
  revision: number
  worktrees: { worktreeId: string; namespace: string; endpoints: RemoteEndpoint[] }[]
}

// Resource ceilings: 1024 inputs of each kind, 512 labels/64 networks per container,
// 4096 characters per input string, 4 MiB aggregate strings, 4096 output endpoints.
const fail = (): never => {
  throw new Error('Invalid remote snapshot metadata')
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const hash = (parts: unknown[]): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
function port(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) fail()
  return value as number
}
function portText(value: string | undefined): number {
  if (!value || !/^[1-9]\d{0,4}$/.test(value)) return fail()
  return port(Number(value))
}
function dns(value: string): string {
  if (
    value.length > 253 ||
    isIPv4(value) ||
    !value.includes('.') ||
    !value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  )
    fail()
  return value.toLowerCase()
}
function privateAddress(value: string): string {
  if (!isIPv4(value)) return fail()
  const [a, b] = value.split('.').map(Number)
  if (!(a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)))
    fail()
  return value
}

/**
 * Pure, all-or-error extraction. No labels, paths, process commands or URLs escape.
 * Generated routers describe transports, NOT application protocols: Compose emits
 * HTTP and TLS-SNI for every port. Never infer an application protocol from a port.
 * Missing liveness/network excludes a source; invalid relevant live metadata throws.
 */
export function buildRemoteSnapshot(input: {
  instanceId: string
  revision: number
  docker: readonly SafeContainer[]
  hosts: readonly SafeHost[]
}): RemoteSnapshot {
  let bytes = 0
  const text = (value: unknown, allowEmpty = false): string => {
    if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.length > 4096)
      return fail()
    bytes += Buffer.byteLength(value)
    if (bytes > 4 * 1024 * 1024) fail()
    return value
  }
  if (
    !record(input) ||
    !Array.isArray(input.docker) ||
    !Array.isArray(input.hosts) ||
    input.docker.length > 1024 ||
    input.hosts.length > 1024 ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    fail()
  const instanceId = text(input.instanceId)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(instanceId)) fail()
  const worktrees = new Map<string, RemoteSnapshot['worktrees'][number]>()
  let count = 0
  const context = (value: WorktreeContext | undefined) => {
    if (!record(value)) return fail()
    const repo = text(value.repo)
    const branch = text(value.branch)
    const domain = text(value.domain).toLowerCase()
    const namespace = dns(formatHostname(branch, domain))
    const worktreeId = hash(['worktree', repo, branch, domain])
    return { worktreeId, namespace }
  }
  const add = (owner: ReturnType<typeof context>, endpoint: RemoteEndpoint) => {
    const tree = worktrees.get(owner.worktreeId) ?? { ...owner, endpoints: [] }
    const prior = tree.endpoints.find(item => item.id === endpoint.id)
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(endpoint)) fail()
      return
    }
    if (++count > 4096) fail()
    tree.endpoints.push(endpoint)
    worktrees.set(owner.worktreeId, tree)
  }
  for (const container of input.docker) {
    if (!record(container) || typeof container.stateRunning !== 'boolean') fail()
    if (!container.stateRunning) continue
    if (!record(container.labels) || Object.keys(container.labels).length > 512) fail()
    const labels = container.labels
    for (const [key, value] of Object.entries(labels)) {
      text(key)
      text(value, true)
    }
    // No unique Port marker exists today. Recognize generated port/alias signatures;
    // arbitrary Traefik routers without those signatures are unrelated.
    const relevant = Object.entries(labels).some(
      ([key, value]) =>
        /^traefik\.(http|tcp)\.routers\./.test(key) &&
        ((/\.entrypoints$/.test(key) && /^port/.test(value)) || /-(?:\d+|alias)\./.test(key))
    )
    if (!relevant) continue
    if (!record(container.networks) || Object.keys(container.networks).length > 64) fail()
    for (const [key, value] of Object.entries(container.networks)) {
      text(key)
      if (!record(value)) fail()
      text(value.IPAddress, true)
    }
    const network = container.networks['traefik-network']
    if (!network || network.IPAddress === '') continue
    if (!record(network)) fail()
    const address = privateAddress(text(network.IPAddress))
    const owner = context(container.context)
    const source = text(container.id)
    const service = text(labels['com.docker.compose.service'])
    if (
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(service) ||
      labels['traefik.enable'] !== 'true'
    )
      fail()
    const expected = new Set<string>()
    const endpoints = new Map<number, RemoteEndpoint>()
    let alias: { name: string; targetPort: number } | undefined
    const routers = new Set<string>()
    for (const key of Object.keys(labels)) {
      const match = /^traefik\.(http|tcp)\.routers\.([^.]+)\./.exec(key)
      if (match) routers.add(`${match[1]}.${match[2]}`)
    }
    for (const router of [...routers].sort(compare)) {
      const separator = router.indexOf('.')
      const protocol = router.slice(0, separator)
      const name = router.slice(separator + 1)
      const prefix = `traefik.${protocol}.routers.${name}`
      const read = (key: string): string => {
        expected.add(key)
        return text(labels[key])
      }
      const entry = read(`${prefix}.entrypoints`)
      const isAlias = protocol === 'http' && entry === 'web'
      const logicalPort = isAlias
        ? undefined
        : portText(entry.startsWith('port') ? entry.slice(4) : undefined)
      // Generator uses the full worktree name in router IDs, but truncated DNS labels.
      const expectedName = `${container.context!.branch}-${service}-${isAlias ? 'alias' : logicalPort}`
      if (name !== expectedName || read(`${prefix}.service`) !== name) fail()
      const hostname = isAlias ? dns(`${service}.${owner.namespace}`) : owner.namespace
      if (read(`${prefix}.rule`) !== `${protocol === 'http' ? 'Host' : 'HostSNI'}(\`${hostname}\`)`)
        fail()
      if (protocol === 'tcp' && read(`${prefix}.tls`) !== 'true') fail()
      const targetPort = portText(
        read(`traefik.${protocol}.services.${name}.loadbalancer.server.port`)
      )
      if (isAlias) {
        if (alias) fail()
        alias = { name: service.toLowerCase(), targetPort }
        continue
      }
      const endpoint = endpoints.get(logicalPort!) ?? {
        id: hash(['docker', owner.worktreeId, source, service, logicalPort]),
        logicalPort: logicalPort!,
        transports: [],
        target: { address, port: targetPort },
      }
      if (endpoint.target.port !== targetPort) fail()
      endpoint.transports.push(protocol === 'http' ? 'http' : 'tls-sni')
      endpoints.set(logicalPort!, endpoint)
    }
    // Middleware, URL backends, TLS passthrough, etc. change semantics: reject them.
    if (Object.keys(labels).some(key => /^traefik\.(http|tcp)\./.test(key) && !expected.has(key)))
      fail()
    if (!endpoints.size) fail()
    if (alias) {
      const matches = [...endpoints.values()].filter(
        endpoint =>
          endpoint.target.port === alias.targetPort && endpoint.transports.includes('http')
      )
      // Labels don't encode which published port is primary if targets repeat.
      if (matches.length !== 1) fail()
      matches[0]!.name = alias.name
      matches[0]!.aliasTransports = ['http']
    }
    for (const endpoint of endpoints.values()) add(owner, endpoint)
  }
  for (const host of input.hosts) {
    if (!record(host) || typeof host.running !== 'boolean') fail()
    if (!host.running) continue
    if (!Number.isSafeInteger(host.pid) || host.pid < 1) fail()
    const owner = context(host)
    const logicalPort = port(host.logicalPort)
    add(owner, {
      id: hash(['host', owner.worktreeId, logicalPort]),
      logicalPort,
      transports: ['http'],
      target: { address: '127.0.0.1', port: port(host.actualPort) },
    })
  }
  return {
    version: 1,
    kind: 'port-service-snapshot',
    instanceId,
    revision: input.revision,
    worktrees: [...worktrees.values()]
      .sort((a, b) => compare(a.worktreeId, b.worktreeId))
      .map(tree => ({
        ...tree,
        endpoints: tree.endpoints.sort((a, b) => compare(a.id, b.id)),
      })),
  }
}

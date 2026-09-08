import { createHash } from 'node:crypto'
import type { RouteOwner } from './routeOwnership.ts'
import { isSshConnectionIdentity, type SshConnectionIdentity } from './sshConnectionIdentity.ts'

interface Reservation {
  connectionIdentity: SshConnectionIdentity
  instanceId: string
  ownerId: string
  alias: string
}

export interface RemoteOwnerRegistryState {
  version: 1
  records: Reservation[]
}

const MAX_OWNERS = 4096
const validInstance = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 128 &&
  !/[^A-Za-z0-9_-]/.test(value)
const validAlias = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 100 &&
  !/[^a-z0-9.-]/.test(value) &&
  value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))

function exactKeys(value: unknown, keys: string): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys
  )
}

function ownerId(identity: SshConnectionIdentity, instanceId: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        identity.hostname,
        identity.port,
        identity.user,
        identity.contextHash,
        instanceId,
      ])
    )
    .digest('hex')
}

function copy(record: Reservation): Reservation {
  return { ...record, connectionIdentity: { ...record.connectionIdentity } }
}

function restore(saved: unknown): Reservation[] {
  if (
    !exactKeys(saved, 'records,version') ||
    saved.version !== 1 ||
    !Array.isArray(saved.records) ||
    saved.records.length > MAX_OWNERS
  )
    throw new Error('Invalid remote owner registry state or capacity exceeded')
  const owners = new Set<string>()
  const aliases = new Set<string>()
  return Array.from(saved.records, (value: unknown) => {
    if (
      !exactKeys(value, 'alias,connectionIdentity,instanceId,ownerId') ||
      !isSshConnectionIdentity(value.connectionIdentity) ||
      !validInstance(value.instanceId) ||
      !validAlias(value.alias) ||
      value.ownerId !== ownerId(value.connectionIdentity, value.instanceId)
    )
      throw new Error('Invalid remote owner reservation')
    const record: Reservation = {
      connectionIdentity: { ...value.connectionIdentity },
      instanceId: value.instanceId,
      ownerId: value.ownerId as string,
      alias: value.alias,
    }
    if (owners.has(record.ownerId) || aliases.has(record.alias))
      throw new Error('Duplicate remote owner or alias reservation')
    owners.add(record.ownerId)
    aliases.add(record.alias)
    return record
  })
}

function allocateAlias(destination: string, id: string, aliases: Set<string>): string {
  const preferred = destination.slice(destination.lastIndexOf('@') + 1).toLowerCase()
  if (validAlias(preferred) && !aliases.has(preferred)) return preferred
  const prefix =
    preferred
      .slice(0, 100)
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 30)
      .replace(/-+$/, '') || 'remote'
  for (let length = 12; length <= 64; length += 4) {
    // Split long digests into DNS labels; even the full digest stays below 100 characters.
    const suffix = id
      .slice(0, length)
      .match(/.{1,32}/g)!
      .join('.')
    const alias = `${prefix}-${suffix}`
    if (!aliases.has(alias)) return alias
  }
  throw new Error('Remote owner alias space exhausted')
}

/** Durable addressing identity, not host-key equivalence. Reservations are never recycled. */
export function createRemoteOwnerRegistry(saved?: unknown) {
  const records = new Map<string, Reservation>()
  const aliases = new Set<string>()
  for (const record of saved === undefined ? [] : restore(saved)) {
    records.set(record.ownerId, record)
    aliases.add(record.alias)
  }
  return {
    resolve(
      connectionIdentity: SshConnectionIdentity,
      instanceId: string,
      destination: string
    ): { owner: RouteOwner; alias: string } {
      if (!isSshConnectionIdentity(connectionIdentity) || !validInstance(instanceId))
        throw new Error('Invalid remote owner identity')
      if (typeof destination !== 'string') throw new Error('Invalid SSH destination')
      const id = ownerId(connectionIdentity, instanceId)
      let record = records.get(id)
      if (!record) {
        if (records.size >= MAX_OWNERS)
          throw new Error('Remote owner registry capacity exhausted (4096)')
        const alias = allocateAlias(destination, id, aliases)
        record = { connectionIdentity: { ...connectionIdentity }, instanceId, ownerId: id, alias }
        records.set(id, record)
        aliases.add(alias)
      }
      return { owner: { kind: 'ssh', id, label: record.alias }, alias: record.alias }
    },
    serialize(): RemoteOwnerRegistryState {
      return { version: 1, records: [...records.values()].map(copy) }
    },
  }
}

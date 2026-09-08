/**
 * Monotonic IPv4 loopback allocation for route identities, not machines alone.
 * Linux binds these addresses directly; other platforms may need address setup.
 * This class does no DNS/listener/filesystem work. The coordinator must persist
 * a snapshot atomically under a lock BEFORE publishing DNS or opening listeners.
 * Never replace unreadable state with an empty book: cached DNS may outlive TTLs.
 */
export interface IngressAddressSnapshot {
  version: 1
  next: number
  entries: { key: string; address: string }[]
}

const LAST = 65534

function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 2048
}

function addressFor(index: number): string {
  return `127.77.${Math.floor(index / 256)}.${index % 256}`
}

function indexFor(address: unknown): number {
  if (typeof address !== 'string') throw new Error('Invalid ingress address')
  const parts = address.split('.')
  const third = Number(parts[2])
  const fourth = Number(parts[3])
  const index = third * 256 + fourth
  if (
    parts.length !== 4 ||
    parts[0] !== '127' ||
    parts[1] !== '77' ||
    !Number.isInteger(third) ||
    !Number.isInteger(fourth) ||
    third < 0 ||
    third > 255 ||
    fourth < 0 ||
    fourth > 255 ||
    index < 1 ||
    index > LAST ||
    addressFor(index) !== address
  )
    throw new Error('Invalid ingress address')
  return index
}

export class IngressAddresses {
  private next = 1
  private readonly entries = new Map<string, string>()

  constructor(snapshot?: IngressAddressSnapshot) {
    if (snapshot === undefined) return
    if (
      snapshot === null ||
      snapshot.version !== 1 ||
      !Number.isInteger(snapshot.next) ||
      snapshot.next < 1 ||
      snapshot.next > LAST + 1 ||
      !Array.isArray(snapshot.entries) ||
      snapshot.entries.length > LAST
    )
      throw new Error('Invalid ingress address state; refusing to reset allocations')
    const addresses = new Set<string>()
    for (const entry of snapshot.entries) {
      if (!entry || !validKey(entry.key) || this.entries.has(entry.key))
        throw new Error('Invalid or duplicate ingress identity')
      const index = indexFor(entry.address)
      if (index >= snapshot.next || addresses.has(entry.address))
        throw new Error('Invalid or duplicate ingress allocation')
      addresses.add(entry.address)
      this.entries.set(entry.key, entry.address)
    }
    this.next = snapshot.next
  }

  /** No release/recycle API: disconnected route identities retain their addresses. */
  allocate(key: string): string {
    if (!validKey(key)) throw new Error('Invalid ingress identity')
    const existing = this.entries.get(key)
    if (existing !== undefined) return existing
    if (this.next > LAST)
      throw new Error('Ingress address pool exhausted; automatic recycling is unsafe')
    const address = addressFor(this.next++)
    this.entries.set(key, address)
    return address
  }

  lookup(key: string): string | undefined {
    return this.entries.get(key)
  }

  snapshot(): IngressAddressSnapshot {
    return {
      version: 1,
      next: this.next,
      entries: Array.from(this.entries, ([key, address]) => ({ key, address })),
    }
  }
}

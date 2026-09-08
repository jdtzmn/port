import { describe, expect, test } from 'vitest'
import { IngressAddresses, type IngressAddressSnapshot } from './ingressAddresses.ts'

describe('stable ingress addresses', () => {
  test('separates namespace, owner, worktree and service route identities', () => {
    const book = new IngressAddresses()
    const keys = [
      ['namespace', 'feature.port'],
      ['owner', 'a', 'tree-1', 'feature.port'],
      ['owner', 'b', 'tree-1', 'feature.port'],
      ['owner', 'a', 'tree-2', 'another.port'],
      ['service', 'a', 'tree-1', 'ui'],
      ['service', 'a', 'tree-1', 'api'],
    ].map(key => JSON.stringify(key))
    const addresses = keys.map(key => book.allocate(key))
    expect(new Set(addresses).size).toBe(keys.length)
    expect(book.allocate(keys[0]!)).toBe(addresses[0])
    expect(book.lookup('unknown')).toBeUndefined()
  })

  test('restoration retains retired identities rather than reusing stale DNS addresses', () => {
    const original = new IngressAddresses()
    const retired = original.allocate('old-owner')
    const restored = new IngressAddresses(original.snapshot())
    expect(restored.allocate('new-owner')).not.toBe(retired)
    expect(restored.allocate('old-owner')).toBe(retired)
    const copy = restored.snapshot()
    copy.entries[0]!.address = '127.77.99.99'
    expect(restored.lookup('old-owner')).toBe(retired)
  })

  test('allocation crosses octet boundaries without collisions', () => {
    const book = new IngressAddresses({ version: 1, next: 255, entries: [] })
    expect(book.allocate('one')).toBe('127.77.0.255')
    expect(book.allocate('two')).toBe('127.77.1.0')
    expect(book.allocate('three')).toBe('127.77.1.1')
  })

  test('exhaustion fails explicitly but existing identities still resolve', () => {
    const book = new IngressAddresses({ version: 1, next: 65534, entries: [] })
    expect(book.allocate('last')).toBe('127.77.255.254')
    expect(() => book.allocate('overflow')).toThrow('exhausted')
    expect(book.allocate('last')).toBe('127.77.255.254')
    expect(new IngressAddresses(book.snapshot()).lookup('last')).toBe('127.77.255.254')
  })

  test.each(['', 'x'.repeat(2049)])('rejects invalid identity length', key => {
    expect(() => new IngressAddresses().allocate(key)).toThrow('identity')
  })

  test.each([
    null,
    { version: 2, next: 1, entries: [] },
    { version: 1, next: 0, entries: [] },
    { version: 1, next: 65536, entries: [] },
    { version: 1, next: 1.5, entries: [] },
    { version: 1, next: 1, entries: {} },
    { version: 1, next: 2, entries: [{ key: 'a', address: '192.168.1.1' }] },
    { version: 1, next: 2, entries: [{ key: 'a', address: '127.77.0.01' }] },
    { version: 1, next: 2, entries: [{ key: 'a', address: '127.77.0.0' }] },
    { version: 1, next: 1, entries: [{ key: 'a', address: '127.77.0.1' }] },
    {
      version: 1,
      next: 3,
      entries: [
        { key: 'a', address: '127.77.0.1' },
        { key: 'a', address: '127.77.0.2' },
      ],
    },
    {
      version: 1,
      next: 3,
      entries: [
        { key: 'a', address: '127.77.0.1' },
        { key: 'b', address: '127.77.0.1' },
      ],
    },
  ])('rejects corrupt allocation state instead of resetting it', state => {
    expect(() => new IngressAddresses(state as IngressAddressSnapshot)).toThrow()
  })
})

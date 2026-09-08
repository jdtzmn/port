import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  createRemoteOwnerRegistry as create,
  type RemoteOwnerRegistryState,
} from './remoteOwnerRegistry.ts'
import type { SshConnectionIdentity } from './sshConnectionIdentity.ts'

const identity: SshConnectionIdentity = {
  hostname: 'actual.example',
  port: 22,
  user: 'alice',
  contextHash: 'a'.repeat(64),
}
const snapshot = () => {
  const registry = create()
  registry.resolve(identity, 'instance', '127.od')
  return registry.serialize()
}
const dns = (alias: string) => {
  expect(alias.length).toBeLessThanOrEqual(100)
  for (const label of alias.split('.'))
    expect(label).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
}

describe('remote owner registry', () => {
  test('keeps a canonical bare alias across reconnects and JSON restarts', () => {
    const registry = create()
    const first = registry.resolve(identity, 'instance', 'Alice@127.OD')
    expect(first).toEqual({
      owner: {
        kind: 'ssh',
        id: createHash('sha256')
          .update(
            JSON.stringify([
              identity.hostname,
              identity.port,
              identity.user,
              identity.contextHash,
              'instance',
            ])
          )
          .digest('hex'),
        label: '127.od',
      },
      alias: '127.od',
    })
    expect(registry.resolve({ ...identity }, 'instance', 'alternate')).toEqual(first)
    const restarted = create(JSON.parse(JSON.stringify(registry.serialize())))
    expect(restarted.resolve(identity, 'instance', 'third')).toEqual(first)
  })

  test('separates cloned IDs by hostname, user, port and proxy context, and separates instances', () => {
    const registry = create()
    const variants = [
      identity,
      { ...identity, hostname: 'clone.example' },
      { ...identity, user: 'Alice' },
      { ...identity, port: 2222 },
      { ...identity, contextHash: 'b'.repeat(64) },
    ]
    const results = variants.map(value => registry.resolve(value, 'clone', 'same'))
    results.push(registry.resolve(identity, 'another-instance', 'same'))
    expect(new Set(results.map(value => value.owner.id)).size).toBe(6)
    expect(new Set(results.map(value => value.alias)).size).toBe(6)
    expect(results[0]!.alias).toBe('same')
    results.forEach(value => dns(value.alias))
  })

  test('retains disconnected reservations and allocates deterministic alternatives', () => {
    const saved = snapshot()
    const a = create(saved)
    const b = create(saved)
    const collision = a.resolve(identity, 'new', '127.od')
    expect(collision.alias).not.toBe('127.od')
    expect(b.resolve(identity, 'new', '127.od')).toEqual(collision)
    const restarted = create(a.serialize())
    expect(restarted.resolve(identity, 'instance', 'new-name').alias).toBe('127.od')
    expect(restarted.resolve(identity, 'new', 'another')).toEqual(collision)
    expect(restarted.serialize().records).toHaveLength(2)
  })

  test('extends colliding suffixes and fails rather than reassigning any alias', () => {
    const targetId = create().resolve(identity, 'target', 'host').owner.id
    const registry = create()
    registry.resolve(identity, 'original', 'host')
    registry.resolve(identity, 'block12', `host-${targetId.slice(0, 12)}`)
    const saved = registry.serialize()
    expect(create(saved).resolve(identity, 'target', 'host').alias).toBe(
      `host-${targetId.slice(0, 16)}`
    )
    for (let length = 16; length <= 64; length += 4) {
      const suffix = targetId
        .slice(0, length)
        .match(/.{1,32}/g)!
        .join('.')
      registry.resolve(identity, `block${length}`, `host-${suffix}`)
    }
    const before = registry.serialize()
    expect(() => registry.resolve(identity, 'target', 'host')).toThrow(/alias space exhausted/)
    expect(registry.serialize()).toEqual(before)
  })

  test.each([
    '',
    '!!!',
    'a b',
    '[2001:DB8::1]',
    'alice@2001:db8::1',
    'a..b',
    '-host',
    'x_',
    'host\n',
    'x'.repeat(101),
    `${'x'.repeat(64)}.com`,
    'ü.example',
  ])('falls back to bounded DNS for %j', destination => {
    const first = create().resolve(identity, 'instance', destination)
    dns(first.alias)
    expect(first.alias).toContain(first.owner.id.slice(0, 12))
    expect(create().resolve(identity, 'instance', destination)).toEqual(first)
  })

  test('isolates caller identity, returned owners, serialized records and restored input', () => {
    const input = { ...identity }
    const registry = create()
    const result = registry.resolve(input, 'instance', 'host')
    const expected = structuredClone(result)
    input.hostname = 'mutated'
    result.owner.label = 'mutated'
    result.owner.id = 'mutated'
    result.alias = 'mutated'
    const saved = registry.serialize()
    const restored = create(saved)
    saved.records[0]!.connectionIdentity.user = 'mutated'
    saved.records[0]!.alias = 'mutated'
    saved.records[0]!.ownerId = 'mutated'
    saved.records.push(saved.records[0]!)
    for (const value of [registry, restored]) {
      expect(value.resolve(identity, 'instance', 'alternate')).toEqual(expected)
      expect(value.serialize().records).toHaveLength(1)
      expect(value.serialize().records[0]!.connectionIdentity).toEqual(identity)
    }
  })

  test.each([
    null,
    false,
    [],
    {},
    { version: 2, records: [] },
    { version: 1, records: {} },
    { version: 1, records: [null] },
    { version: 1, records: new Array(1) },
    { version: 1, records: [], extra: true },
  ])('rejects malformed state %j', value => {
    expect(() => create(value)).toThrow()
  })

  test('strictly rejects corrupt records and duplicate aliases or owners', () => {
    const mutations: ((state: RemoteOwnerRegistryState) => void)[] = [
      state => {
        state.records[0]!.ownerId = '0'.repeat(64)
      },
      state => {
        state.records[0]!.connectionIdentity.user = 'bob'
      },
      state => {
        state.records[0]!.connectionIdentity.contextHash = 'bad'
      },
      state => {
        state.records[0]!.instanceId = '../bad'
      },
      state => {
        state.records[0]!.alias = 'Host'
      },
      state => {
        state.records[0]!.alias = 'host\n'
      },
      state => {
        state.records[0]!.alias = 'x'.repeat(101)
      },
      state => {
        Object.assign(state.records[0]!, { proxyCommand: 'not allowed' })
      },
      state => {
        Object.assign(state.records[0]!.connectionIdentity, { proxyCommand: 'not allowed' })
      },
      state => {
        state.records.push({ ...state.records[0]!, alias: 'different' })
      },
      state => {
        const registry = create()
        registry.resolve(identity, 'different', '127.od')
        state.records.push(registry.serialize().records[0]!)
      },
    ]
    for (const mutate of mutations) {
      const state = snapshot()
      mutate(state)
      expect(() => create(state)).toThrow()
    }
  })

  test.each(['', '../bad', 'a b', 'x\n', 'x'.repeat(129)])(
    'rejects invalid instance %j without reserving',
    instance => {
      const registry = create()
      expect(() => registry.resolve(identity, instance, 'host')).toThrow(/identity/)
      expect(registry.serialize().records).toEqual([])
    }
  )

  test('rejects invalid connection identity', () => {
    expect(() => create().resolve({ ...identity, port: 0 }, 'instance', 'host')).toThrow(/identity/)
  })

  test('explicitly exhausts capacity while keeping existing owners resolvable after restart', () => {
    const registry = create()
    for (let index = 0; index < 4096; index++) registry.resolve(identity, `i${index}`, `h${index}`)
    const restored = create(registry.serialize())
    expect(() => restored.resolve(identity, 'overflow', 'extra')).toThrow(/capacity exhausted/)
    expect(restored.resolve(identity, 'i0', 'alternate').alias).toBe('h0')
    const oversized = registry.serialize()
    oversized.records.push(oversized.records[0]!)
    expect(() => create(oversized)).toThrow(/capacity/)
    expect(restored.serialize().records).toHaveLength(4096)
  })
})

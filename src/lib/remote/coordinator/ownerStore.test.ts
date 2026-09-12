import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRemoteOwnerRegistry } from './ownerRegistry.ts'
import { allocateRemoteOwners, type RemoteOwnerAllocationRequest } from './ownerStore.ts'

const request = (instanceId = 'one'): RemoteOwnerAllocationRequest => ({
  connectionIdentity: {
    hostname: 'private.example',
    port: 22,
    user: 'private-user',
    contextHash: 'a'.repeat(64),
  },
  instanceId,
  destination: 'same.example',
})
const error = 'Remote owner store unavailable'
let parent: string
let root: string
let path: string

beforeEach(async () => {
  parent = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'owner-store-')))
  root = join(parent, 'store')
  path = join(root, 'owners.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(parent, { recursive: true, force: true })
})
async function seed() {
  return allocateRemoteOwners(root, [request()])
}
async function put(content: string | Buffer) {
  await fs.mkdir(root, { mode: 0o700 })
  await fs.writeFile(path, content, { mode: 0o600 })
}

describe('remote owner store', () => {
  test('persists across restart and returns detached state with no request methods', async () => {
    const first = await seed()
    expect(Object.keys(first).sort()).toEqual(['records', 'version'])
    const restarted = await allocateRemoteOwners(root, [])
    expect(restarted).toEqual(first)
    expect(createRemoteOwnerRegistry(restarted).serialize()).toEqual(first)
    first.records[0]!.connectionIdentity.hostname = 'mutated'
    first.records[0]!.alias = 'mutated'
    expect(await allocateRemoteOwners(root, [])).toEqual(restarted)
    expect((await fs.stat(root)).mode & 0o777).toBe(0o700)
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600)
    expect(await fs.readdir(root)).toEqual(['owners.json', 'owners.sqlite'])
  })

  test('deduplicates batches without changing old aliases', async () => {
    const state = await allocateRemoteOwners(root, [
      request(),
      request(),
      { ...request(), destination: 'other' },
    ])
    expect(state.records).toHaveLength(1)
    expect(state.records[0]!.alias).toBe('same.example')
    expect(await allocateRemoteOwners(root, [{ ...request(), destination: 'new' }])).toEqual(state)
  })

  test('concurrent callers reload under the lock and lose no reservations', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => allocateRemoteOwners(root, [request(`id-${i}`)]))
    )
    const state = await allocateRemoteOwners(root, [])
    expect(state.records).toHaveLength(12)
    expect(new Set(state.records.map(record => record.instanceId)).size).toBe(12)
    expect(new Set(state.records.map(record => record.alias)).size).toBe(12)
  })

  test('reserves collision aliases permanently across subsequent batches', async () => {
    const first = await seed()
    const second = await allocateRemoteOwners(root, [request('two')])
    expect(second.records[0]).toEqual(first.records[0])
    expect(second.records[1]!.alias).not.toBe(first.records[0]!.alias)
    const third = await allocateRemoteOwners(root, [request('three')])
    expect(third.records.slice(0, 2)).toEqual(second.records)
  })

  test('preserves bytes, inode and timestamps on no-op, including noncanonical JSON', async () => {
    const state = await seed()
    const bytes = JSON.stringify(state, null, 4) + '\n\n'
    await fs.writeFile(path, bytes)
    const before = await fs.stat(path)
    expect(await allocateRemoteOwners(root, [request()])).toEqual(state)
    const after = await fs.stat(path)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.ctimeMs).toBe(before.ctimeMs)
    expect(await fs.readFile(path, 'utf8')).toBe(bytes)
  })

  test('empty missing state is a no-op', async () => {
    expect(await allocateRemoteOwners(root, [])).toEqual({ version: 1, records: [] })
    expect(await fs.readdir(root)).toEqual(['owners.sqlite'])
  })

  test.each([
    '{private-invalid-json',
    'null',
    '{}',
    '{"version":2,"records":[]}',
    '{"version":1,"records":[{}]}',
  ])('fails closed for malformed state %s', async content => {
    await put(content)
    await expect(seed()).rejects.toThrow(error)
    expect(await fs.readFile(path, 'utf8')).toBe(content)
  })

  test('rejects oversized state without truncating it', async () => {
    await put(Buffer.alloc(16 * 1024 * 1024 + 1, 32))
    await expect(seed()).rejects.toThrow(error)
    expect((await fs.stat(path)).size).toBe(16 * 1024 * 1024 + 1)
  })

  test.each([0o644, 0o400, 0o660, 0o4600])('rejects unsafe state mode %o', async mode => {
    await seed()
    await fs.chmod(path, mode)
    await expect(seed()).rejects.toThrow(error)
    expect((await fs.stat(path)).mode & 0o7777).toBe(mode)
  })

  test.each(['symlink', 'hardlink', 'directory', 'fifo'])(
    'rejects %s state without opening special files',
    async kind => {
      await fs.mkdir(root, { mode: 0o700 })
      const target = join(parent, 'target')
      await fs.writeFile(target, 'private sentinel', { mode: 0o600 })
      if (kind === 'symlink') await fs.symlink(target, path)
      if (kind === 'hardlink') await fs.link(target, path)
      if (kind === 'directory') await fs.mkdir(path)
      if (kind === 'fifo') execFileSync('mkfifo', [path])
      await expect(seed()).rejects.toThrow(error)
      expect(await fs.readFile(target, 'utf8')).toBe('private sentinel')
    }
  )

  test.each(['permissions', 'symlink', 'file'])('rejects unsafe %s root', async kind => {
    if (kind === 'permissions') await fs.mkdir(root, { mode: 0o755 })
    if (kind === 'symlink') await fs.symlink(parent, root)
    if (kind === 'file') await fs.writeFile(root, '')
    await expect(seed()).rejects.toThrow(error)
  })

  test.each(['symlink', 'directory', 'fifo', 'corrupt', 'writable', 'hardlink'])(
    'sanitizes unsafe %s mutex database failures',
    async kind => {
      await put(JSON.stringify(createRemoteOwnerRegistry().serialize()))
      const before = await fs.readFile(path)
      const lock = join(root, 'owners.sqlite')
      if (kind === 'symlink') await fs.symlink(path, lock)
      if (kind === 'hardlink') await fs.link(path, lock)
      if (kind === 'directory') await fs.mkdir(lock)
      if (kind === 'fifo') execFileSync('mkfifo', [lock])
      if (kind === 'corrupt') await fs.writeFile(lock, 'not SQLite', { mode: 0o600 })
      if (kind === 'writable') {
        await fs.writeFile(lock, '')
        await fs.chmod(lock, 0o666)
      }
      await expect(seed()).rejects.toThrow(error)
      expect(await fs.readFile(path)).toEqual(before)
    }
  )

  test('retains the permanent mutex inode across allocations and no-op calls', async () => {
    await seed()
    const database = join(root, 'owners.sqlite')
    const pin = await fs.lstat(database)
    expect(pin.isFile()).toBe(true)
    expect(pin.mode & 0o7777).toBe(0o600)
    for (const batch of [[request('two')], [], [request('three')]]) {
      await allocateRemoteOwners(root, batch)
      const current = await fs.lstat(database)
      expect(current.ino).toBe(pin.ino)
      expect(current.dev).toBe(pin.dev)
      expect(current.nlink).toBe(1)
    }
  })

  test('failed batch validation does not partially save or reveal input', async () => {
    await seed()
    const before = await fs.readFile(path)
    await expect(
      allocateRemoteOwners(root, [request('two'), request('private/invalid')])
    ).rejects.toThrow(error)
    expect(await fs.readFile(path)).toEqual(before)
    await expect(
      allocateRemoteOwners(
        root,
        Array.from({ length: 4097 }, () => request())
      )
    ).rejects.toThrow(error)
    expect(await fs.readFile(path)).toEqual(before)
  })

  test('invalid persisted alias collisions are not repaired', async () => {
    const state = await allocateRemoteOwners(root, [request(), request('two')])
    state.records[1]!.alias = state.records[0]!.alias
    await fs.writeFile(path, JSON.stringify(state))
    const before = await fs.readFile(path)
    await expect(seed()).rejects.toThrow(error)
    expect(await fs.readFile(path)).toEqual(before)
  })
})

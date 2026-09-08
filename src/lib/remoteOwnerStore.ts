import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { createRemoteOwnerRegistry, type RemoteOwnerRegistryState } from './remoteOwnerRegistry.ts'
import type { SshConnectionIdentity } from './sshConnectionIdentity.ts'
import { withRemoteMutex } from './remoteMutex.ts'

const MAX_BYTES = 16 * 1024 * 1024
const unavailable = (): never => {
  throw new Error('Remote owner store unavailable')
}
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid
const owned = (s: Stats, mode: number) => s.uid === process.getuid?.() && (s.mode & 0o7777) === mode
const unchanged = (a: Stats, b: Stats) =>
  same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs

export interface RemoteOwnerAllocationRequest {
  connectionIdentity: SshConnectionIdentity
  instanceId: string
  destination: string
}

async function rootInfo(root: string): Promise<Stats> {
  if (!isAbsolute(root) || normalize(root) !== root || (await realpath(root)) !== root)
    unavailable()
  const info = await lstat(root)
  if (!info.isDirectory() || !owned(info, 0o700)) unavailable()
  return info
}

async function checkRoot(root: string, pin: Stats): Promise<void> {
  if (!same(await rootInfo(root), pin)) unavailable()
}

async function optionalStat(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error
    return null
  }
}

function checkFile(info: Stats): void {
  if (!info.isFile() || !owned(info, 0o600) || info.nlink !== 1 || info.size > MAX_BYTES)
    unavailable()
}

async function checkPin(path: string, pin: Stats | null): Promise<void> {
  const current = await optionalStat(path)
  if (!pin) {
    if (current) unavailable()
    return
  }
  if (!current) return unavailable()
  checkFile(current)
  if (!unchanged(current, pin)) unavailable()
}

async function load(path: string): Promise<{ pin: Stats | null; state: RemoteOwnerRegistryState }> {
  const pin = await optionalStat(path)
  if (!pin) return { pin, state: createRemoteOwnerRegistry().serialize() }
  checkFile(pin)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    checkFile(info)
    if (!unchanged(info, pin)) unavailable()
    const bytes = Buffer.alloc(MAX_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_BYTES) unavailable()
    const text = bytes.subarray(0, length).toString('utf8')
    if (!bytes.subarray(0, length).equals(Buffer.from(text))) unavailable()
    const state = createRemoteOwnerRegistry(JSON.parse(text)).serialize()
    const after = await file.stat()
    checkFile(after)
    if (!unchanged(after, pin)) unavailable()
    await checkPin(path, pin)
    return { pin, state }
  } finally {
    await file.close()
  }
}

async function save(root: string, rootPin: Stats, pin: Stats | null, state: string): Promise<void> {
  const bytes = Buffer.from(state + '\n')
  if (bytes.length > MAX_BYTES) unavailable()
  await checkRoot(root, rootPin)
  const directory = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  const temp = join(root, `owners-${randomUUID()}.tmp`)
  let tempPin: Stats | undefined
  try {
    if (!same(await directory.stat(), rootPin)) unavailable()
    const file = await open(
      temp,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600
    )
    try {
      tempPin = await file.stat()
      checkFile(tempPin)
      await file.writeFile(bytes)
      await file.sync()
      const after = await file.stat()
      checkFile(after)
      if (!same(after, tempPin)) unavailable()
      tempPin = after
    } finally {
      await file.close()
    }
    await checkRoot(root, rootPin)
    await checkPin(join(root, 'owners.json'), pin)
    await checkPin(temp, tempPin)
    await rename(temp, join(root, 'owners.json'))
    await directory.sync()
    await checkRoot(root, rootPin)
    const published = await lstat(join(root, 'owners.json'))
    checkFile(published)
    // Rename may change ctime, but not the inode, bytes or modification time.
    if (
      !same(published, tempPin) ||
      published.size !== tempPin.size ||
      published.mtimeMs !== tempPin.mtimeMs
    )
      unavailable()
  } finally {
    try {
      await checkRoot(root, rootPin)
      const current = await optionalStat(temp)
      if (tempPin && current && same(current, tempPin)) await unlink(temp)
    } finally {
      await directory.close()
    }
  }
}

/**
 * Atomically reserve a bounded batch, retaining every historical reservation.
 * The canonical private directory is the same-UID trust boundary; callers must
 * not mutate it behind the lock. No caller code or network work runs under it.
 */
export async function allocateRemoteOwners(
  root: string,
  requests: readonly RemoteOwnerAllocationRequest[]
): Promise<RemoteOwnerRegistryState> {
  try {
    if (!Array.isArray(requests) || requests.length > 4096) unavailable()
    // Detach and validate before taking the lock (including caller-owned getters).
    const batch = structuredClone(requests)
    const validation = createRemoteOwnerRegistry()
    for (const request of batch)
      validation.resolve(request.connectionIdentity, request.instanceId, request.destination)
    try {
      await mkdir(root, { mode: 0o700 })
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error
    }
    const rootPin = await rootInfo(root)
    // Keep the mutex inode permanent; only the JSON state is atomically replaced.
    return await withRemoteMutex(join(root, 'owners.sqlite'), async () => {
      await checkRoot(root, rootPin)
      const path = join(root, 'owners.json')
      const { pin, state } = await load(path)
      const registry = createRemoteOwnerRegistry(state)
      for (const request of batch)
        registry.resolve(request.connectionIdentity, request.instanceId, request.destination)
      const result = registry.serialize()
      const serialized = JSON.stringify(result)
      if (serialized !== JSON.stringify(state)) await save(root, rootPin, pin, serialized)
      else {
        await checkRoot(root, rootPin)
        await checkPin(path, pin)
      }
      return result
    })
  } catch {
    return unavailable()
  }
}

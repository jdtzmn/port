import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { withRemoteMutex } from './remoteMutex.ts'
import { createRemoteOwnerRegistry, type RemoteOwnerRegistryState } from './remoteOwnerRegistry.ts'
import {
  restoreRemoteCoordinatorState,
  type RemoteCoordinatorCheckpoint,
} from './remoteCoordinatorState.ts'
import {
  restoreRemoteSessionObservation,
  type RemoteSessionObservationPin,
} from './remoteSession.ts'
import { parseRemoteSnapshot, type RemoteSnapshot } from './remoteSnapshot.ts'
import { parseRemoteRouteSnapshot, type RemoteRouteSnapshot } from './remoteRouteSnapshot.ts'

const LIMIT = 16 * 1024 * 1024
const fail = (): never => {
  throw new Error('Invalid remote runtime state')
}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

function privateFile(stat: Stats) {
  if (
    !stat.isFile() ||
    stat.uid !== process.getuid?.() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o7777) !== 0o600 ||
    stat.size > LIMIT
  )
    fail()
}

async function directory(path: string, privateMode = true) {
  const stat = await lstat(path)
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (privateMode ? (stat.mode & 0o7777) !== 0o700 : (stat.mode & 0o7022) !== 0)
  )
    fail()
  return stat
}

async function read(path: string): Promise<string | undefined> {
  let file
  let seen = false
  try {
    const before = await lstat(path)
    seen = true
    privateFile(before)
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const held = await file.stat()
    privateFile(held)
    if (!same(before, held)) fail()
    const bytes = Buffer.alloc(held.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    const after = await file.stat()
    privateFile(after)
    if (
      length !== held.size ||
      after.size !== held.size ||
      after.mtimeMs !== held.mtimeMs ||
      after.ctimeMs !== held.ctimeMs ||
      !same(after, await lstat(path))
    )
      fail()
    const content = bytes.subarray(0, length)
    const text = content.toString('utf8')
    if (!content.equals(Buffer.from(text))) fail()
    return text
  } catch (error) {
    // Only absence before opening is a missing file, not a disappearing opened file.
    if (!seen && missing(error)) return undefined
    return fail()
  } finally {
    await file?.close()
  }
}

/** Caller holds the permanent publication/catalog mutex; never use for arbitrary paths. */
async function replace(root: string, name: string, text: string, privateMode = true) {
  if (Buffer.byteLength(text) > LIMIT) fail()
  const parent = await directory(root, privateMode)
  const target = join(root, name)
  let previous: Stats | undefined
  try {
    previous = await lstat(target)
    privateFile(previous)
  } catch (error) {
    if (!missing(error)) throw error
  }
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`)
  const file = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600
  )
  const pin = await file.stat()
  try {
    await file.writeFile(text)
    await file.sync()
    await file.close()
    if (!same(parent, await directory(root, privateMode))) fail()
    let current: Stats | undefined
    try {
      current = await lstat(target)
    } catch (error) {
      if (!missing(error)) throw error
    }
    if (previous ? !current || !same(previous, current) : current !== undefined) fail()
    if (!same(pin, await lstat(temporary))) fail()
    await rename(temporary, target)
    const dir = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try {
      if (!same(parent, await dir.stat())) fail()
      await dir.sync()
    } finally {
      await dir.close()
    }
  } finally {
    await file.close()
    try {
      if (same(pin, await lstat(temporary))) await unlink(temporary)
    } catch {
      // A failed scratch-file cleanup must not mask a publication failure.
      // Never remove a replaced file or anything outside this private directory.
    }
  }
}

function pins(value: unknown): RemoteSessionObservationPin[] {
  if (!Array.isArray(value) || value.length > 4096) return fail()
  const result = value.map(pin => restoreRemoteSessionObservation(pin).checkpoint())
  if (new Set(result.map(pin => pin.sessionId)).size !== result.length) fail()
  return result
}

export interface RemoteRuntimeCheckpoint {
  version: 1
  pins: RemoteSessionObservationPin[]
  ownership: RemoteCoordinatorCheckpoint
  local: RemoteSnapshot | null
  /** Optional so an existing v1 checkpoint can be upgraded by the next published frame. */
  routes?: RemoteRouteSnapshot
}

function checkpoint(value: unknown, owners: RemoteOwnerRegistryState): RemoteRuntimeCheckpoint {
  const data = value as RemoteRuntimeCheckpoint
  const keys = Object.keys(data ?? {})
    .sort()
    .join(',')
  if (
    !data ||
    (keys !== 'local,ownership,pins,version' && keys !== 'local,ownership,pins,routes,version') ||
    data.version !== 1
  )
    return fail()
  const catalog = pins(data.pins)
  const ownership = restoreRemoteCoordinatorState(
    createRemoteOwnerRegistry(owners),
    data.ownership
  ).checkpoint()
  const records = new Map(owners.records.map(record => [record.ownerId, record]))
  const identities = new Map(catalog.map(pin => [pin.sessionId, pin.connectionIdentity]))
  for (const session of ownership.sessions) {
    if (session.frame === null) continue
    const identity = identities.get(session.sessionId)
    const record = records.get(session.frame.ownerId)
    if (
      !identity ||
      !record ||
      identity.hostname !== record.connectionIdentity.hostname ||
      identity.port !== record.connectionIdentity.port ||
      identity.user !== record.connectionIdentity.user ||
      identity.contextHash !== record.connectionIdentity.contextHash
    )
      fail()
  }
  return {
    version: 1,
    pins: catalog,
    ownership,
    local: data.local === null ? null : parseRemoteSnapshot(JSON.stringify(data.local)),
    ...(data.routes ? { routes: parseRemoteRouteSnapshot(JSON.stringify(data.routes)) } : {}),
  }
}

/** Registration is a separate append-only journal: a frame cannot erase a newer admission. */
export async function readRemoteCatalog(root: string): Promise<RemoteSessionObservationPin[]> {
  await directory(root)
  const text = await read(join(root, 'catalog.json'))
  if (text === undefined) return []
  const data = JSON.parse(text)
  if (!data || Object.keys(data).sort().join(',') !== 'pins,version' || data.version !== 1)
    return fail()
  return pins(data.pins)
}

export async function registerRemotePin(
  root: string,
  pin: RemoteSessionObservationPin
): Promise<void> {
  const validated = pins([pin])[0]!
  await withRemoteMutex(join(root, 'catalog.sqlite'), async () => {
    const catalog = await readRemoteCatalog(root)
    if (catalog.some(item => item.sessionId === validated.sessionId)) return
    if (catalog.length >= 4096) fail()
    catalog.push(validated)
    await replace(root, 'catalog.json', JSON.stringify({ version: 1, pins: catalog }))
  })
}

export async function readRemoteCheckpoint(
  root: string,
  owners: RemoteOwnerRegistryState
): Promise<RemoteRuntimeCheckpoint | undefined> {
  await directory(root)
  const text = await read(join(root, 'checkpoint.json'))
  return text === undefined ? undefined : checkpoint(JSON.parse(text), owners)
}

/** A complete, durable ownership decision precedes its YAML. Close never deletes routing guards. */
export function createRemotePublisher(options: {
  root: string
  dynamicDirectory: string
  incarnation: string
  isCurrent(): Promise<boolean>
}) {
  const { root, dynamicDirectory, incarnation } = options
  if (!/^[a-f0-9]{32}$/.test(incarnation)) fail()
  const filename = 'port-remote-routes.yml'
  let activated = false
  return {
    async activate(owners: RemoteOwnerRegistryState) {
      await withRemoteMutex(join(root, 'publication.sqlite'), async () => {
        if (!(await options.isCurrent())) fail()
        const saved = await readRemoteCheckpoint(root, owners)
        const yaml = await read(join(dynamicDirectory, filename))
        // Missing recovery data must never be interpreted as an empty prior installation.
        if (!saved && yaml !== undefined) fail()
        const previous = await read(join(root, 'leader.json'))
        if (previous !== undefined) {
          const data = JSON.parse(previous)
          if (
            !data ||
            Object.keys(data).sort().join(',') !== 'incarnation,version' ||
            data.version !== 1 ||
            !/^[a-f0-9]{32}$/.test(data.incarnation)
          )
            fail()
        }
        await replace(root, 'leader.json', JSON.stringify({ version: 1, incarnation }))
        activated = true
      })
    },
    async publish(
      owners: RemoteOwnerRegistryState,
      state: RemoteRuntimeCheckpoint,
      content: string
    ) {
      // Detach BEFORE awaiting the lock, pairing this checkpoint with precisely this YAML.
      const saved = checkpoint(structuredClone(state), owners)
      const text = JSON.stringify(saved)
      if (typeof content !== 'string' || Buffer.byteLength(content) > LIMIT) fail()
      await withRemoteMutex(join(root, 'publication.sqlite'), async () => {
        const leader = await read(join(root, 'leader.json'))
        if (
          !activated ||
          !leader ||
          JSON.parse(leader).incarnation !== incarnation ||
          !(await options.isCurrent())
        )
          fail()
        await readRemoteCheckpoint(root, owners) // Do not overwrite corrupt recovery data.
        if ((await read(join(root, 'checkpoint.json'))) !== text)
          await replace(root, 'checkpoint.json', text)
        const yaml = `# Port remote routes v1\n${content}`
        const previous = await read(join(dynamicDirectory, filename))
        if (previous !== undefined && !previous.startsWith('# Port remote routes v1\n')) fail()
        if (previous !== yaml) await replace(dynamicDirectory, filename, yaml, false)
      })
    },
  }
}

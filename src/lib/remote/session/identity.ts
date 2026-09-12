import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { withFileLock } from '../../state.ts'

const MAX_BYTES = 256
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const fail = (): never => {
  throw new Error('Remote identity unavailable')
}
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

async function directory(path: string, uid: number, privateMode: boolean): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
  }
  const info = await lstat(path)
  if (!info.isDirectory() || info.uid !== uid || info.mode & (privateMode ? 0o077 : 0o022)) {
    fail()
  }
}

async function readIdentity(path: string, uid: number): Promise<string> {
  // Inspect before opening to reject special files without blocking; O_NOFOLLOW
  // and fstat also validate the actual opened file, not just the pathname.
  const info = await lstat(path)
  if (!info.isFile() || info.uid !== uid || (info.mode & 0o777) !== 0o600) fail()
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      stat.uid !== uid ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > MAX_BYTES ||
      stat.ino !== info.ino ||
      stat.dev !== info.dev
    )
      fail()
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > MAX_BYTES) fail()
    const value = JSON.parse(buffer.subarray(0, size).toString('utf8'))
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'instanceId,version' ||
      value.version !== 1 ||
      typeof value.instanceId !== 'string' ||
      value.instanceId.length !== 36 ||
      !UUID.test(value.instanceId)
    )
      fail()
    return value.instanceId
  } finally {
    await handle.close()
  }
}

/** Persistent user-owned identifier, not an authentication credential. */
export async function getRemoteInstanceId(): Promise<string> {
  try {
    const uid = process.getuid?.()
    if (uid === undefined) return fail()
    const parent = join(homedir(), '.port')
    const root = join(parent, 'remote-identity')
    await directory(parent, uid, false)
    await directory(root, uid, true)
    return await withFileLock(join(root, 'identity.lock'), async () => {
      const path = join(root, 'identity.json')
      // Only a missing pathname permits creation. Invalid existing data is never repaired.
      try {
        await lstat(path)
      } catch (error) {
        if (!missing(error)) throw error
        const instanceId = randomUUID()
        const handle = await open(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600
        )
        try {
          await handle.writeFile(JSON.stringify({ version: 1, instanceId }) + '\n')
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
      return readIdentity(path, uid)
    })
  } catch {
    return fail()
  }
}

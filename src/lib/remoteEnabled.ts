import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { GLOBAL_PORT_DIR } from './registry.ts'

/** Tiny synchronous probe for shell startup; never reads arbitrary configuration or secrets. */
export function isRemoteRuntimeEnabled(root = join(GLOBAL_PORT_DIR, 'remote')): boolean {
  let fd: number | undefined
  try {
    const parent = lstatSync(root)
    if (
      !parent.isDirectory() ||
      parent.uid !== process.getuid?.() ||
      (parent.mode & 0o7777) !== 0o700
    )
      return false
    const path = join(root, 'enabled.json')
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o7777) !== 0o600 ||
      stat.size > 128
    )
      return false
    const bytes = Buffer.alloc(129)
    const length = readSync(fd, bytes, 0, bytes.length, 0)
    const after = lstatSync(path)
    const current = lstatSync(root)
    if (
      length !== stat.size ||
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      current.dev !== parent.dev ||
      current.ino !== parent.ino
    )
      return false
    const data = JSON.parse(bytes.subarray(0, length).toString('utf8'))
    return (
      Object.keys(data).sort().join(',') === 'enabled,version' &&
      data.version === 1 &&
      data.enabled === true
    )
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

import { constants } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

interface SQLiteConnection {
  exec(sql: string): unknown
  close(): void
}

type SQLiteConstructor = new (path: string) => SQLiteConnection

export interface RemoteMutexOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

// POSIX record locks are process-scoped: closing even a validation descriptor
// can release SQLite's locks. Serialize local invocations before opening any
// descriptors (including aliases through trusted ancestor paths).
let locallyHeld = false

async function connect(path: string): Promise<SQLiteConnection> {
  // Fixed runtime module names: Node 24 supports sqlite, but our Node 20 types do not.
  if (typeof Bun !== 'undefined') {
    const { Database } = await import('bun:sqlite')
    return new Database(path, { create: false, readwrite: true })
  }
  const moduleName = 'node:sqlite'
  const { DatabaseSync } = (await import(moduleName)) as {
    DatabaseSync: SQLiteConstructor
  }
  return new DatabaseSync(path)
}

function isBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const sqlite = error as { code?: string; errcode?: number; errno?: number }
  // Node exposes errcode; Bun exposes errno/code. Include extended result codes.
  const code = sqlite.errcode ?? sqlite.errno
  return (
    (typeof code === 'number' && [5, 6].includes(code & 0xff)) ||
    sqlite.code === 'SQLITE_BUSY' ||
    sqlite.code === 'SQLITE_LOCKED'
  )
}

async function validatePin(path: string, handle: FileHandle, directory: boolean): Promise<void> {
  const [held, current] = await Promise.all([handle.stat(), lstat(path)])
  const uid = process.getuid?.()
  if (
    uid === undefined ||
    held.uid !== uid ||
    current.uid !== uid ||
    held.dev !== current.dev ||
    held.ino !== current.ino ||
    (held.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
    (current.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
    (directory
      ? !held.isDirectory() || !current.isDirectory()
      : !held.isFile() || !current.isFile() || held.nlink !== 1 || current.nlink !== 1)
  ) {
    throw new Error(`Unsafe or replaced remote mutex ${directory ? 'directory' : 'file'}`)
  }
}

/**
 * Cross-process mutex, backed by SQLite's OS locks. The owned, real 0700 parent
 * is a same-user trust boundary (not protection against malicious same-UID code).
 * Its ancestors must be trusted too. The 0600 database inode is permanent:
 * never unlink, rename, or replace it, even after crashes. No application data
 * is stored; SQLite's journal/sidecars remain inside the private parent.
 *
 * signal cancels acquisition ONLY. Once acquired, callback must settle before
 * rollback/close; abort never releases a lock beneath a running callback.
 * timeoutMs (default 30s) bounds acquisition, not callback execution.
 * Local calls (even for different databases) are serialized and not reentrant.
 * No other code in this process may open/close the mutex inode while held.
 */
export async function withRemoteMutex<T>(
  databasePath: string,
  callback: () => Promise<T>,
  { timeoutMs = 30_000, signal }: RemoteMutexOptions = {}
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('timeoutMs must be finite and nonnegative')
  }
  const deadline = performance.now() + timeoutMs
  signal?.throwIfAborted()
  const path = resolve(databasePath)
  const parent = dirname(path)
  while (locallyHeld) {
    signal?.throwIfAborted()
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw new Error('Remote mutex acquisition timed out')
    await delay(Math.min(20, remaining), undefined, { signal })
  }
  signal?.throwIfAborted()
  locallyHeld = true
  try {
    return await withPinnedMutex(path, parent, callback, deadline, signal)
  } finally {
    locallyHeld = false
  }
}

async function withPinnedMutex<T>(
  path: string,
  parent: string,
  callback: () => Promise<T>,
  deadline: number,
  signal?: AbortSignal
): Promise<T> {
  const directory = await open(
    parent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  let file: FileHandle | undefined
  let database: SQLiteConnection | undefined
  let acquired = false
  try {
    await validatePin(parent, directory, true)
    try {
      file = await open(
        path,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // O_NONBLOCK ensures an unsafe FIFO cannot hang validation.
      file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    }
    const checkPins = async () => {
      await validatePin(parent, directory, true)
      await validatePin(path, file!, false)
    }
    await checkPins()
    database = await connect(path)
    await checkPins()
    database.exec('PRAGMA busy_timeout = 0')
    let attempted = false
    for (;;) {
      signal?.throwIfAborted()
      await checkPins()
      signal?.throwIfAborted()
      if (attempted && performance.now() >= deadline) {
        throw new Error('Remote mutex acquisition timed out')
      }
      attempted = true
      try {
        database.exec('BEGIN IMMEDIATE')
        acquired = true
        break
      } catch (error) {
        if (!isBusy(error)) throw error
        const remaining = deadline - performance.now()
        if (remaining <= 0) throw new Error('Remote mutex acquisition timed out')
        await delay(Math.min(20, remaining), undefined, { signal })
      }
    }
    await checkPins()
    signal?.throwIfAborted()
    return await callback()
  } finally {
    // Nested finally blocks guarantee close attempts even when rollback fails.
    try {
      try {
        if (acquired) database!.exec('ROLLBACK')
      } finally {
        database?.close()
      }
    } finally {
      try {
        await file?.close()
      } finally {
        await directory.close()
      }
    }
  }
}

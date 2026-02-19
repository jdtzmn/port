import { open, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'

interface FileLockOptions {
  timeoutMs?: number
  retryDelayMs?: number
  /** If the lock file is older than this, assume the holder crashed and remove it. */
  staleLockThresholdMs?: number
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isFileMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Check if a process with the given PID is still running.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // Signal 0 doesn't kill, just checks existence
    return true
  } catch {
    return false
  }
}

/**
 * Read the PID stored in a lock file.
 * Returns null if the file can't be read or doesn't contain a valid PID.
 */
async function readLockPid(lockFilePath: string): Promise<number | null> {
  try {
    const content = await readFile(lockFilePath, 'utf-8')
    const pid = parseInt(content.trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export async function withFileLock<T>(
  lockFilePath: string,
  callback: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10000
  const retryDelayMs = options.retryDelayMs ?? 25
  const staleLockThresholdMs = options.staleLockThresholdMs ?? 30000
  const startTimeMs = Date.now()
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null

  while (!lockHandle) {
    try {
      lockHandle = await open(lockFilePath, 'wx')
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error
      }

      // Check if the existing lock is stale
      let isStale = false
      try {
        // First check: is the lock holder process still alive?
        const lockPid = await readLockPid(lockFilePath)
        if (lockPid !== null && !isProcessAlive(lockPid)) {
          isStale = true
        }

        // Second check: is the lock file older than the stale threshold?
        if (!isStale) {
          const lockStat = await stat(lockFilePath)
          const lockAge = Date.now() - lockStat.mtimeMs
          if (lockAge > staleLockThresholdMs) {
            isStale = true
          }
        }
      } catch {
        // Lock file disappeared between the open() and stat() — retry will succeed
        continue
      }

      if (isStale) {
        try {
          await unlink(lockFilePath)
        } catch {
          // Another process may have already cleaned it up
        }
        continue
      }

      if (Date.now() - startTimeMs >= timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockFilePath}`)
      }

      await sleep(retryDelayMs)
    }
  }

  try {
    // Write our PID to the lock file so other processes can detect stale locks
    await lockHandle.write(Buffer.from(String(process.pid)))
    return await callback()
  } finally {
    await lockHandle.close()
    try {
      await unlink(lockFilePath)
    } catch (error) {
      if (!isFileMissingError(error)) {
        // Best effort cleanup: lock will eventually be replaced/cleaned manually.
      }
    }
  }
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempFilePath = `${filePath}.${process.pid}.${randomUUID()}.tmp`

  try {
    await writeFile(tempFilePath, content)
    await rename(tempFilePath, filePath)
  } catch (error) {
    try {
      await unlink(tempFilePath)
    } catch (cleanupError) {
      if (!isFileMissingError(cleanupError)) {
        throw cleanupError
      }
    }
    throw error
  }
}

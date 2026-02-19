import { open, rename, stat, unlink, writeFile } from 'fs/promises'
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

      // Check if the existing lock is stale (holder likely crashed)
      try {
        const lockStat = await stat(lockFilePath)
        const lockAge = Date.now() - lockStat.mtimeMs
        if (lockAge > staleLockThresholdMs) {
          try {
            await unlink(lockFilePath)
          } catch {
            // Another process may have already cleaned it up
          }
          continue
        }
      } catch {
        // Lock file disappeared between the open() and stat() — retry will succeed
        continue
      }

      if (Date.now() - startTimeMs >= timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockFilePath}`)
      }

      await sleep(retryDelayMs)
    }
  }

  try {
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

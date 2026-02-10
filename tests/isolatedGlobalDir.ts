import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, vi } from 'vitest'

const TEST_GLOBAL_PORT_DIR_ENV = 'PORT_GLOBAL_DIR'

interface IsolatedPortGlobalDirOptions {
  resetModules?: boolean
}

export function useIsolatedPortGlobalDir(
  prefix: string,
  options?: IsolatedPortGlobalDirOptions
): { getDir: () => string } {
  let originalGlobalPortDir: string | undefined
  let isolatedGlobalPortDir = ''

  beforeAll(async () => {
    originalGlobalPortDir = process.env[TEST_GLOBAL_PORT_DIR_ENV]
    isolatedGlobalPortDir = await mkdtemp(join(tmpdir(), `${prefix}-`))
    process.env[TEST_GLOBAL_PORT_DIR_ENV] = isolatedGlobalPortDir

    if (options?.resetModules) {
      vi.resetModules()
    }
  })

  afterAll(async () => {
    if (originalGlobalPortDir === undefined) {
      delete process.env[TEST_GLOBAL_PORT_DIR_ENV]
    } else {
      process.env[TEST_GLOBAL_PORT_DIR_ENV] = originalGlobalPortDir
    }

    await rm(isolatedGlobalPortDir, { recursive: true, force: true })
  })

  return {
    getDir: () => isolatedGlobalPortDir,
  }
}

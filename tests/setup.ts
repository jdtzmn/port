import 'cli-testing-library/vitest'
import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll } from 'vitest'
import { cleanupAllTempDirs, bringDownAllComposeProjects } from './utils'

const TEST_GLOBAL_PORT_DIR_ENV = 'PORT_GLOBAL_DIR'

const isolatedGlobalPortDir = mkdtempSync(join(tmpdir(), 'port-global-state-'))
process.env[TEST_GLOBAL_PORT_DIR_ENV] = isolatedGlobalPortDir

/**
 * Global cleanup hook: Remove all temp directories created during tests
 */
afterAll(async () => {
  await bringDownAllComposeProjects()
  await cleanupAllTempDirs()

  await rm(isolatedGlobalPortDir, { recursive: true, force: true })

  delete process.env[TEST_GLOBAL_PORT_DIR_ENV]
})

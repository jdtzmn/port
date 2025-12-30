import 'cli-testing-library/vitest'
import { afterAll } from 'vitest'
import { cleanupAllTempDirs, bringDownAllComposeProjects } from './utils'

/**
 * Global cleanup hook: Remove all temp directories created during tests
 */
afterAll(async () => {
  await bringDownAllComposeProjects()
  cleanupAllTempDirs()
})

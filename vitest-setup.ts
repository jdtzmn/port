import 'cli-testing-library/vitest'
import { afterAll } from 'vitest'
import { cleanupAllTempDirs } from './tests/utils'

/**
 * Global cleanup hook: Remove all temp directories created during tests
 */
afterAll(() => {
  cleanupAllTempDirs()
})

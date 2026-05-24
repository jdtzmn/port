import 'cli-testing-library/vitest'
import { afterAll } from 'vitest'
import { cleanupAllTempDirs, bringDownAllComposeProjects } from './utils'

try {
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true })
  Object.defineProperty(process.stderr, 'columns', { value: 200, configurable: true })
} catch {
  // Ignore if the stream properties are read-only in this runtime.
}

process.env.COLUMNS = process.env.COLUMNS ?? '200'
process.env.LINES = process.env.LINES ?? '60'

/**
 * Global cleanup hook: Remove all temp directories created during tests
 */
afterAll(async () => {
  await bringDownAllComposeProjects()
  await cleanupAllTempDirs()
})

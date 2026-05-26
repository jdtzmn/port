import 'cli-testing-library/vitest'
import { afterAll } from 'vitest'
import { execAsync } from '../src/lib/exec'
import { cleanupAllTempDirs, bringDownAllComposeProjects } from './utils'

try {
  Object.defineProperty(process.stdout, 'columns', { value: 200, configurable: true })
  Object.defineProperty(process.stderr, 'columns', { value: 200, configurable: true })
} catch {
  // Ignore if the stream properties are read-only in this runtime.
}

process.env.COLUMNS = process.env.COLUMNS ?? '200'
process.env.LINES = process.env.LINES ?? '60'

async function pruneUnusedDockerNetworks(): Promise<void> {
  try {
    await execAsync('docker network prune -f')
  } catch {
    // Ignore when Docker is unavailable or pruning fails.
  }
}

await pruneUnusedDockerNetworks()

/**
 * Global cleanup hook: Remove all temp directories created during tests
 */
afterAll(async () => {
  await bringDownAllComposeProjects()
  await cleanupAllTempDirs()
  await pruneUnusedDockerNetworks()
})

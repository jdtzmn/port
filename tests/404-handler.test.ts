import { execPortAsync, prepareSample } from './utils'
import { describe, test, expect, afterAll } from 'vitest'

const TIMEOUT = 300000 // Image build + container start can take a while
const CLEANUP_TIMEOUT = 60000 // Compose teardown + network prune can exceed Vitest's 10s default

/** Poll until the 404 handler responds or we time out */
async function fetchUntilReady(url: string, maxWaitMs = 120000): Promise<Response> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        const res = await fetch(url, { signal: controller.signal })
        return res
      } finally {
        clearTimeout(timeout)
      }
    } catch {
      // Not ready yet — wait and retry
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for 404 handler at ${url}`)
}

describe('404 handler', () => {
  let cleanup: (() => Promise<void>) | undefined

  // `cleanup()` already runs `docker compose down` for the sample (and any
  // worktrees) before removing the temp dir, so there is no need to also
  // call `safeDown` here. Doing both was duplicating the compose teardown
  // and the network prune, which pushed the hook past Vitest's default
  // 10s `hookTimeout` on slow CI shards.
  afterAll(async () => {
    if (cleanup) await cleanup()
  }, CLEANUP_TIMEOUT)

  test(
    'serves Port Directory page for unmatched hosts',
    async () => {
      // Bring up any worktree — we just need Traefik + the 404 handler running
      const sample = await prepareSample('nextjs-app', { initWithConfig: true })
      cleanup = sample.cleanup

      await execPortAsync(['up'], sample.dir)

      // Request a hostname that has no matching Traefik route.
      // Traefik's catch-all router (priority 1) forwards it to the 404 handler.
      const url = 'http://nonexistent.port'
      const response = await fetchUntilReady(url)

      expect(response.status).toBe(404)

      const body = await response.text()
      expect(body).toContain('Port Directory')
    },
    TIMEOUT
  )
})

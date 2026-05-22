import { execPortAsync, prepareSample, safeDown } from './utils'
import { describe, test, expect, afterAll } from 'vitest'

const TIMEOUT = 300000 // Image build + container start can take a while

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
  let sampleDir: string
  let cleanup: () => Promise<void>

  afterAll(async () => {
    if (sampleDir) await safeDown(sampleDir)
    if (cleanup) await cleanup()
  })

  test(
    'serves Port Directory page for unmatched hosts',
    async () => {
      // Bring up any worktree — we just need Traefik + the 404 handler running
      const sample = await prepareSample('nextjs-app', { initWithConfig: true })
      sampleDir = sample.dir
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

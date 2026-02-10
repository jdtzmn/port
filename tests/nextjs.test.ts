import { join } from 'path'
import { execPortAsync, prepareSample } from './utils'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 120000 // Next.js takes longer to start than other frameworks

/** UUID regex for validating a complete string */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** UUID regex for searching within text */
const UUID_SEARCH_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Helper to fetch JSON from a URL with retries
 */
async function fetchJson<T>(url: string, maxWaitTime = 60000): Promise<T> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const res = await fetch(url)
      if (res.status === 200) {
        return res.json() as Promise<T>
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url} to respond`)
}

describe('Next.js routing through Traefik', () => {
  test(
    'separate worktrees have unique server UUIDs',
    async () => {
      const sample = await prepareSample('nextjs-app', {
        initWithConfig: true,
      })

      // Create two worktrees (--no-shell so they exit immediately)
      await execPortAsync(['next-a', '--no-shell'], sample.dir)
      await execPortAsync(['next-b', '--no-shell'], sample.dir)

      // Navigate to the worktree directories and run `up`
      // Note: branch names are lowercased by sanitizeBranchName
      const worktreeADir = join(sample.dir, './.port/trees/next-a')
      const worktreeBDir = join(sample.dir, './.port/trees/next-b')

      await execPortAsync(['up'], worktreeADir)
      await execPortAsync(['up'], worktreeBDir)

      // Fetch UUIDs from both worktrees via API route
      const aApiUrl = 'http://next-a.port:3000/api/id'
      const bApiUrl = 'http://next-b.port:3000/api/id'

      const aResponse = await fetchJson<{ id: string }>(aApiUrl)
      const bResponse = await fetchJson<{ id: string }>(bApiUrl)

      // Each server should have a unique UUID
      expect(aResponse.id).not.toEqual(bResponse.id)

      // Verify UUIDs are valid UUID format
      expect(aResponse.id).toMatch(UUID_REGEX)
      expect(bResponse.id).toMatch(UUID_REGEX)

      // Cleanup
      await execPortAsync(['down', '-y'], worktreeADir)
      await execPortAsync(['down', '-y'], worktreeBDir)
      await sample.cleanup()
    },
    TIMEOUT
  )

  test(
    'same worktree returns consistent UUID across requests',
    async () => {
      const sample = await prepareSample('nextjs-app', {
        initWithConfig: true,
      })

      await execPortAsync(['up'], sample.dir)

      const apiUrl = `${sample.urlWithPort(3000)}/api/id`

      // Make multiple requests
      const response1 = await fetchJson<{ id: string }>(apiUrl)
      const response2 = await fetchJson<{ id: string }>(apiUrl)
      const response3 = await fetchJson<{ id: string }>(apiUrl)

      // All requests should return the same UUID
      expect(response1.id).toEqual(response2.id)
      expect(response2.id).toEqual(response3.id)

      // Verify it's a valid UUID
      expect(response1.id).toMatch(UUID_REGEX)

      // Cleanup
      await execPortAsync(['down', '-y'], sample.dir)
      await sample.cleanup()
    },
    TIMEOUT
  )

  test(
    'page route responds with valid HTML containing UUID',
    async () => {
      const sample = await prepareSample('nextjs-app', {
        initWithConfig: true,
      })

      await execPortAsync(['up'], sample.dir)

      const pageUrl = sample.urlWithPort(3000)

      // Wait for the page to respond and verify it contains a UUID
      const startTime = Date.now()
      const maxWaitTime = 60000

      let pageHtml = ''
      while (Date.now() - startTime < maxWaitTime) {
        try {
          const res = await fetch(pageUrl)
          if (res.status === 200) {
            pageHtml = await res.text()
            break
          }
        } catch {
          // Service not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // Verify the page contains a UUID (the server ID rendered by the page component)
      const uuidMatch = pageHtml.match(UUID_SEARCH_REGEX)
      expect(uuidMatch).not.toBeNull()

      // Verify it's valid HTML
      expect(pageHtml).toContain('<!DOCTYPE html>')
      expect(pageHtml).toContain('</html>')

      // Cleanup
      await execPortAsync(['down', '-y'], sample.dir)
      await sample.cleanup()
    },
    TIMEOUT
  )
})

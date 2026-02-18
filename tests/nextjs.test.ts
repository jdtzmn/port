import { join } from 'path'
import { execPortAsync, fetchWithTimeout, prepareSample } from './utils'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 240000 // Next.js takes longer to start than other frameworks

/** Max time to poll for a service to respond (leave headroom for setup/teardown) */
const POLL_TIMEOUT = 150000

/** UUID regex for validating a complete string */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** UUID regex for searching within text */
const UUID_SEARCH_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Helper to fetch JSON from a URL with retries.
 * Retries on network errors, non-200 responses, and JSON parse failures.
 */
async function fetchJson<T>(url: string, maxWaitTime = POLL_TIMEOUT): Promise<T> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const res = await fetchWithTimeout(url)
      if (res.status === 200) {
        return (await res.json()) as T
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url} to respond`)
}

/**
 * Helper to fetch HTML from a URL, retrying until it contains expected content.
 */
async function fetchHtmlWithContent(
  url: string,
  contentCheck: (html: string) => boolean,
  maxWaitTime = POLL_TIMEOUT
): Promise<string> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const res = await fetchWithTimeout(url)
      if (res.status === 200) {
        const html = await res.text()
        if (contentCheck(html)) {
          return html
        }
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url} to return expected content`)
}

async function safeDown(worktreePath: string): Promise<void> {
  try {
    await execPortAsync(['down', '-y'], worktreePath)
  } catch {
    // Best-effort cleanup in failure scenarios.
  }
}

describe('Next.js routing through Traefik', () => {
  test(
    'separate worktrees have unique server UUIDs',
    async () => {
      const sample = await prepareSample('nextjs-app', {
        initWithConfig: true,
      })

      // Create two worktrees
      await execPortAsync(['enter', 'next-a'], sample.dir)
      await execPortAsync(['enter', 'next-b'], sample.dir)

      // Navigate to the worktree directories and run `up`
      // Note: branch names are lowercased by sanitizeBranchName
      const worktreeADir = join(sample.dir, './.port/trees/next-a')
      const worktreeBDir = join(sample.dir, './.port/trees/next-b')

      try {
        // Create two worktrees (--no-shell so they exit immediately)
        await execPortAsync(['next-a', '--no-shell'], sample.dir)
        await execPortAsync(['next-b', '--no-shell'], sample.dir)

        // Start worktrees sequentially to avoid concurrent image builds
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
      } finally {
        await safeDown(worktreeADir)
        await safeDown(worktreeBDir)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'same worktree returns consistent UUID across requests',
    async () => {
      const sample = await prepareSample('nextjs-app', {
        initWithConfig: true,
      })

      try {
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
      } finally {
        await safeDown(sample.dir)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'page route responds with valid HTML containing UUID',
    async () => {
      const sample = await prepareSample('nextjs-app', {
        initWithConfig: true,
      })

      try {
        await execPortAsync(['up'], sample.dir)

        const pageUrl = sample.urlWithPort(3000)

        // Poll until the page returns HTML containing a UUID.
        // Next.js dev server may return a loading/compiling page before the
        // actual content is ready, so we keep retrying until the UUID appears.
        const pageHtml = await fetchHtmlWithContent(pageUrl, html => UUID_SEARCH_REGEX.test(html))

        // Verify the page contains a UUID (the server ID rendered by the page component)
        const uuidMatch = pageHtml.match(UUID_SEARCH_REGEX)
        expect(uuidMatch).not.toBeNull()

        // Verify it's valid HTML
        expect(pageHtml).toContain('<!DOCTYPE html>')
        expect(pageHtml).toContain('</html>')
      } finally {
        await safeDown(sample.dir)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )
})

import { join } from 'path'
import { execPortAsync, prepareSample } from './utils'
import { execAsync } from '../src/lib/exec'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 240000 // Next.js takes longer to start than other frameworks

/** Max time to poll for a service to respond (leave headroom for setup/teardown) */
const POLL_TIMEOUT = 150000

const TRAEFIK_CONTAINER = 'port-traefik'

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
  let lastStatus = 'none'
  let lastBody = ''

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await curlRequest(url)
      lastStatus = response.status.toString()
      lastBody = response.body.slice(0, 300)

      if (response.status === 200) {
        const json = JSON.parse(response.body)
        return json as T
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  await logTimeoutDiagnostics(url, lastStatus, lastBody)
  throw new Error(
    `Timed out waiting for ${url} to respond (last status=${lastStatus}, body=${JSON.stringify(lastBody)})`
  )
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
  let lastStatus = 'none'
  let lastBody = ''

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await curlRequest(url)
      lastStatus = response.status.toString()
      lastBody = response.body.slice(0, 300)

      if (response.status === 200) {
        const html = response.body
        if (contentCheck(html)) {
          return html
        }
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  await logTimeoutDiagnostics(url, lastStatus, lastBody)
  throw new Error(
    `Timed out waiting for ${url} to return expected content (last status=${lastStatus}, body=${JSON.stringify(lastBody)})`
  )
}

async function runDiag(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command)
    return stdout.trim()
  } catch {
    return '(command failed)'
  }
}

function resolveHostForUrl(url: string): string {
  const parsed = new URL(url)
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  return `${parsed.hostname}:${port}:127.0.0.1`
}

function buildCurlProbeCommand(url: string): string {
  return [
    'curl -sS --max-time 5 --noproxy "*"',
    `--resolve ${shellQuote(resolveHostForUrl(url))}`,
    '-D -',
    `${shellQuote(url)}`,
    '| head -40',
  ].join(' ')
}

async function logTimeoutDiagnostics(
  url: string,
  lastStatus: string,
  lastBody: string
): Promise<void> {
  console.error('--- DIAGNOSTICS ---')
  console.error('docker ps:', await runDiag('docker ps -a'))
  console.error('docker network ls:', await runDiag('docker network ls'))
  console.error('traefik logs:', await runDiag(`docker logs --tail 80 ${TRAEFIK_CONTAINER}`))
  console.error(
    'traefik routers:',
    await runDiag(
      `docker exec ${TRAEFIK_CONTAINER} sh -lc ${shellQuote('wget -qO- http://127.0.0.1:8080/api/http/routers || true')}`
    )
  )
  console.error('curl probe:', await runDiag(buildCurlProbeCommand(url)))
  console.error(`dns lookup:`, await runDiag(`getent hosts ${new URL(url).hostname}`))
  console.error('last status:', lastStatus)
  console.error('last body snippet:', lastBody)
  console.error('--- END DIAGNOSTICS ---')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function curlRequest(url: string): Promise<{ status: number; body: string }> {
  const command = [
    'curl -sS --max-time 5 --noproxy "*"',
    `--resolve ${shellQuote(resolveHostForUrl(url))}`,
    `${shellQuote(url)}`,
    '-w "\\n%{http_code}"',
  ].join(' ')

  const { stdout } = await execAsync(command)
  const trimmed = stdout.trimEnd()
  const splitIndex = trimmed.lastIndexOf('\n')

  if (splitIndex === -1) {
    return { status: 0, body: trimmed }
  }

  const body = trimmed.slice(0, splitIndex)
  const statusText = trimmed.slice(splitIndex + 1).trim()
  const status = parseInt(statusText, 10)

  return {
    status: Number.isFinite(status) ? status : 0,
    body,
  }
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

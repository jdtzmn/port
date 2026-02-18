import { join } from 'path'
import { execPortAsync, prepareSample } from '@tests/utils'
import { execAsync } from '../lib/exec'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 180000
const POLL_TIMEOUT = 120000
const TRAEFIK_CONTAINER = 'port-traefik'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`
}

function resolveHostForUrl(url: string): string {
  const parsed = new URL(url)
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  return `${parsed.hostname}:${port}:127.0.0.1`
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

async function runDiag(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command)
    return stdout.trim()
  } catch {
    return '(command failed)'
  }
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
  aURL: string,
  bURL: string,
  lastAStatus: string,
  lastABody: string,
  lastBStatus: string,
  lastBBody: string
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
  console.error('curl probe a:', await runDiag(buildCurlProbeCommand(aURL)))
  console.error('curl probe b:', await runDiag(buildCurlProbeCommand(bURL)))
  console.error('dns a.port:', await runDiag('getent hosts a.port'))
  console.error('dns b.port:', await runDiag('getent hosts b.port'))
  console.error('last status a:', lastAStatus)
  console.error('last body a:', lastABody)
  console.error('last status b:', lastBStatus)
  console.error('last body b:', lastBBody)
  console.error('--- END DIAGNOSTICS ---')
}

async function safeDown(worktreePath: string): Promise<void> {
  try {
    await execPortAsync(['down', '-y'], worktreePath)
  } catch {
    // Best-effort cleanup for failed tests.
  }
}

describe('parallel worktrees', () => {
  test(
    'separate worktrees have separate domains without conflict',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      const worktreeADir = join(sample.dir, './.port/trees/a')
      const worktreeBDir = join(sample.dir, './.port/trees/b')

      try {
        // Create worktrees (--no-shell so they exit immediately)
        await execPortAsync(['A', '--no-shell'], sample.dir)
        await execPortAsync(['B', '--no-shell'], sample.dir)

        // Start worktrees sequentially to avoid concurrent image builds
        await execPortAsync(['up'], worktreeADir)
        await execPortAsync(['up'], worktreeBDir)

        // Wait for both pages to load and have different content
        const aURL = 'http://a.port:3000'
        const bURL = 'http://b.port:3000'

        const maxWaitTime = POLL_TIMEOUT
        const startTime = Date.now()
        let textA = ''
        let textB = ''
        let lastAStatus = 'none'
        let lastBStatus = 'none'
        let lastABody = ''
        let lastBBody = ''
        let ready = false

        while (Date.now() - startTime < maxWaitTime) {
          try {
            const [resA, resB] = await Promise.all([curlRequest(aURL), curlRequest(bURL)])

            lastAStatus = resA.status.toString()
            lastBStatus = resB.status.toString()
            lastABody = resA.body.slice(0, 300)
            lastBBody = resB.body.slice(0, 300)

            if (resA.status === 200 && resB.status === 200) {
              textA = resA.body
              textB = resB.body
              ready = true
              break
            }
          } catch {
            // Services not ready yet, continue polling
          }
          await new Promise(resolve => setTimeout(resolve, 1000))
        }

        if (!ready) {
          await logTimeoutDiagnostics(aURL, bURL, lastAStatus, lastABody, lastBStatus, lastBBody)
          throw new Error(
            `Timed out waiting for services to respond (a=${lastAStatus}, b=${lastBStatus})`
          )
        }

        expect(textA).not.toEqual(textB)
      } finally {
        await safeDown(worktreeADir)
        await safeDown(worktreeBDir)
        await sample.cleanup()
      }
    },
    TIMEOUT + 1000
  )
})

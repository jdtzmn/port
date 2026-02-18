import { join } from 'path'
import { execPortAsync, prepareSample } from '@tests/utils'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 180000
const POLL_TIMEOUT = 120000
const REQUEST_TIMEOUT = 5000

async function fetchWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
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
        let ready = false

        while (Date.now() - startTime < maxWaitTime) {
          try {
            const [resA, resB] = await Promise.all([fetchWithTimeout(aURL), fetchWithTimeout(bURL)])

            if (resA.status === 200 && resB.status === 200) {
              textA = await resA.text()
              textB = await resB.text()
              ready = true
              break
            }
          } catch {
            // Services not ready yet, continue polling
          }
          await new Promise(resolve => setTimeout(resolve, 1000))
        }

        if (!ready) {
          throw new Error('Timed out waiting for services to respond')
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

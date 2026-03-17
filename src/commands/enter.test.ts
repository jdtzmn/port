import { existsSync } from 'fs'
import { join } from 'path'
import { execPortAsync, fetchWithTimeout, prepareSample, safeDown } from '@tests/utils'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 240000
const POLL_TIMEOUT = 150000

/**
 * Poll a single URL until it returns HTTP 200, then return the body text.
 * Polls independently so a transient failure on one service does not
 * discard a successful response from another (unlike Promise.all).
 */
async function pollForText(url: string, maxWaitTime: number): Promise<string> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const res = await fetchWithTimeout(url)
      if (res.status === 200) {
        return await res.text()
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url} to respond`)
}

describe('parallel worktrees', () => {
  test(
    'enter + up works without running port init first',
    async () => {
      const sample = await prepareSample('db-and-server', {
        gitInit: true,
      })

      const branch = 'no-init-e2e'
      const worktreeDir = join(sample.dir, `./.port/trees/${branch}`)
      const url = `http://${branch}.port:3000`

      try {
        await execPortAsync(['enter', branch], sample.dir)
        expect(existsSync(worktreeDir)).toBe(true)
        expect(existsSync(join(sample.dir, '.port/.gitignore'))).toBe(true)

        await execPortAsync(['up'], worktreeDir)
        expect(existsSync(join(worktreeDir, '.port/override.yml'))).toBe(true)

        const text = await pollForText(url, POLL_TIMEOUT)
        expect(text).toContain('Hello from')
      } finally {
        await safeDown(worktreeDir)
        await sample.cleanup()
      }
    },
    TIMEOUT + 1000
  )

  test(
    'separate worktrees have separate domains without conflict',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      // Create worktrees
      await execPortAsync(['enter', 'A'], sample.dir)
      await execPortAsync(['enter', 'B'], sample.dir)

      // Navigate to the worktree directories and run `up`
      // Note: branch names are lowercased by sanitizeBranchName
      const worktreeADir = join(sample.dir, './.port/trees/a')
      const worktreeBDir = join(sample.dir, './.port/trees/b')

      try {
        // Start worktrees sequentially to avoid concurrent image builds
        await execPortAsync(['up'], worktreeADir)
        await execPortAsync(['up'], worktreeBDir)

        // Poll each service independently so a transient Traefik restart
        // (caused by parallel test workers) doesn't discard a successful
        // response from the other service.
        const aURL = 'http://a.port:3000'
        const bURL = 'http://b.port:3000'

        const [textA, textB] = await Promise.all([
          pollForText(aURL, POLL_TIMEOUT),
          pollForText(bURL, POLL_TIMEOUT),
        ])

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

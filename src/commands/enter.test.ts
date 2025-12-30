import { join } from 'path'
import { execPortAsync, prepareSample } from '@tests/utils'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 60000

describe('parallel worktrees', () => {
  test(
    'separate worktrees have separate domains without conflict',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      // Create worktrees (--no-shell so they exit immediately)
      await execPortAsync(['A', '--no-shell'], sample.dir)
      await execPortAsync(['B', '--no-shell'], sample.dir)

      // Navigate to the worktree directories and run `up`
      // Note: branch names are lowercased by sanitizeBranchName
      const worktreeADir = join(sample.dir, './.port/trees/a')
      const worktreeBDir = join(sample.dir, './.port/trees/b')

      await execPortAsync(['up'], worktreeADir)
      await execPortAsync(['up'], worktreeBDir)

      // Wait for both pages to load and have different content
      const aURL = 'http://a.port:3000'
      const bURL = 'http://b.port:3000'

      await new Promise<void>(resolve =>
        setInterval(async () => {
          const resA = await fetch(aURL)
          const resB = await fetch(bURL)

          if (resA.status === 200 && resB.status === 200) {
            clearInterval()

            expect(await resA.text()).not.toEqual(await resB.text())
            resolve()
          }
        }, 1000)
      )

      // End the sample (use -y to skip Traefik confirmation prompt)
      await execPortAsync(['down', '-y'], worktreeADir)
      await execPortAsync(['down', '-y'], worktreeBDir)

      await sample.cleanup()
    },
    TIMEOUT + 1000
  )
})

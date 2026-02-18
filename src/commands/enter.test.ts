import { join } from 'path'
import { execPortAsync, prepareSample } from '@tests/utils'
import { execAsync } from '../lib/exec'
import { describe, test, expect } from 'vitest'

const TIMEOUT = 180000

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

      // Start worktrees sequentially to avoid concurrent image builds
      await execPortAsync(['up'], worktreeADir)
      await execPortAsync(['up'], worktreeBDir)

      // Wait for both pages to load and have different content
      const aURL = 'http://a.port:3000'
      const bURL = 'http://b.port:3000'

      const maxWaitTime = 120000
      const startTime = Date.now()
      let textA = ''
      let textB = ''
      let ready = false

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const [resA, resB] = await Promise.all([fetch(aURL), fetch(bURL)])

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
        // Dump diagnostic info for CI debugging
        const diag = async (cmd: string) => {
          try {
            const { stdout } = await execAsync(cmd)
            return stdout.trim()
          } catch {
            return '(command failed)'
          }
        }
        console.error('--- DIAGNOSTICS ---')
        console.error('docker ps:', await diag('docker ps -a'))
        console.error('docker network ls:', await diag('docker network ls'))
        console.error(
          'traefik routers:',
          await diag('curl -s http://localhost:1211/api/http/routers')
        )
        console.error('dns a.port:', await diag('getent hosts a.port'))
        console.error('--- END DIAGNOSTICS ---')
        throw new Error('Timed out waiting for services to respond')
      }

      expect(textA).not.toEqual(textB)

      // End the sample (use -y to skip Traefik confirmation prompt)
      await execPortAsync(['down', '-y'], worktreeADir)
      await execPortAsync(['down', '-y'], worktreeBDir)

      await sample.cleanup()
    },
    TIMEOUT + 1000
  )
})

import { join } from 'path'
import { existsSync } from 'fs'
import { test, expect } from 'vitest'
import { execPortAsync, prepareSample } from './utils'
import { execAsync } from '../src/lib/exec'

const TIMEOUT = 60000

test(
  'removes the current worktree when port rm is run from inside it',
  async () => {
    const sample = await prepareSample('simple-server', {
      initWithConfig: true,
    })

    try {
      // Create a worktree
      await execPortAsync(['enter', 'test-rm'], sample.dir)
      const worktreePath = join(sample.dir, '.port/trees/test-rm')
      expect(existsSync(worktreePath)).toBe(true)

      // Remove it from inside the worktree (--force skips confirmation)
      await execPortAsync(['rm', '-f'], worktreePath)

      // Verify worktree directory is gone
      expect(existsSync(worktreePath)).toBe(false)

      // Verify the branch was archived
      const { stdout } = await execAsync("git branch --list 'archive/test-rm-*'", {
        cwd: sample.dir,
      })
      expect(stdout.trim()).toMatch(/^archive\/test-rm-/)
    } finally {
      await sample.cleanup()
    }
  },
  TIMEOUT
)

import { join } from 'path'
import { existsSync } from 'fs'
import { test, expect } from 'vitest'
import { execPortAsync, prepareSample } from './utils'
import { execFileAsync } from '../src/lib/exec'

const TIMEOUT = 60000

/**
 * Return true if a local branch with the exact given name exists.
 *
 * Uses execFile (no shell) so the branch name is matched verbatim, which keeps
 * names containing spaces or other metacharacters intact.
 */
async function localBranchExists(repoDir: string, branch: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['branch', '--list', branch], { cwd: repoDir })
  return stdout.trim().length > 0
}

test(
  'enters a worktree for a branch name with spaces (explicit and implicit forms)',
  async () => {
    const sample = await prepareSample('simple-server', {
      initWithConfig: true,
    })

    try {
      // Explicit form: `port enter my feature` (bare multi-word args).
      // The branch name is not a valid git ref, so it resolves to "my-feature"
      // for both the git branch and the on-disk worktree directory.
      await execPortAsync(['enter', 'my feature'], sample.dir)

      const worktreePath = join(sample.dir, '.port/trees/my-feature')
      expect(existsSync(worktreePath)).toBe(true)
      expect(await localBranchExists(sample.dir, 'my-feature')).toBe(true)
      // The raw spaced name is never used as an actual git ref.
      expect(await localBranchExists(sample.dir, 'my feature')).toBe(false)

      // Implicit form: `port my feature` reuses the same worktree (idempotent),
      // and does not create a duplicate or a nested worktree.
      await execPortAsync(['my', 'feature'], sample.dir)

      expect(existsSync(worktreePath)).toBe(true)
      const nestedPath = join(worktreePath, '.port/trees/my-feature')
      expect(existsSync(nestedPath)).toBe(false)
    } finally {
      await sample.cleanup()
    }
  },
  TIMEOUT
)

import { join } from 'path'
import { existsSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { test, expect } from 'vitest'
import { execPortAsync, prepareSample, tempDirRegistry } from './utils'
import { execFileAsync } from '../src/lib/exec'

const TIMEOUT = 60000

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

test(
  'enters a remote branch that has not been fetched yet',
  async () => {
    const sample = await prepareSample('simple-server', { gitInit: true })
    const remoteDir = await mkdtemp(join(tmpdir(), 'port-test-remote-'))
    tempDirRegistry.add(remoteDir)

    try {
      // Wire the sample up to a bare remote, then create a branch on the remote
      // only, so the local repo knows nothing about it until it fetches.
      await git(remoteDir, 'init', '--bare')
      await git(sample.dir, 'remote', 'add', 'origin', remoteDir)
      await git(sample.dir, 'push', '-u', 'origin', 'main')

      await git(sample.dir, 'branch', 'WT')
      await git(sample.dir, 'push', 'origin', 'WT')
      await git(sample.dir, 'branch', '-D', 'WT')
      await git(sample.dir, 'update-ref', '-d', 'refs/remotes/origin/WT')

      expect(await git(sample.dir, 'branch', '-r', '--list', 'origin/WT')).toBe('')

      const { stderr } = await execPortAsync(['enter', 'WT'], sample.dir)
      expect(stderr).not.toMatch(/Failed to create worktree/)

      const worktreePath = join(sample.dir, '.port/trees/wt')
      expect(existsSync(worktreePath)).toBe(true)
      expect(await git(worktreePath, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/WT')
    } finally {
      await sample.cleanup()
      await rm(remoteDir, { recursive: true, force: true })
      tempDirRegistry.delete(remoteDir)
    }
  },
  TIMEOUT
)

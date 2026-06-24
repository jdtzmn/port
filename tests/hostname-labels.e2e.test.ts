import { join } from 'path'
import { describe, expect, test } from 'vitest'
import { execAsync } from '../src/lib/exec'
import { formatHostnameLabel } from '../src/lib/hostname'
import { sanitizeBranchName } from '../src/lib/sanitize'
import { execPortAsync, fetchWithTimeout, prepareSample, safeDown } from './utils'

const TIMEOUT = 120000

async function hasDockerDaemon(): Promise<boolean> {
  try {
    await execAsync('docker info >/dev/null 2>&1')
    return true
  } catch {
    return false
  }
}

async function pollUntilReady(url: string, timeoutMs = 30000): Promise<Response> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url)
      if (response.status === 200) {
        return response
      }
    } catch {
      // Not ready yet
    }

    await new Promise(resolve => setTimeout(resolve, 200))
  }

  throw new Error(`Timeout waiting for ${url} to respond`)
}

async function createWorktree(repoDir: string, branch: string): Promise<string> {
  const worktreePath = join(repoDir, '.port/trees', sanitizeBranchName(branch))
  await execAsync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: repoDir })
  return worktreePath
}

describe.sequential('hostname label e2e', () => {
  test(
    'trims long branch hostnames in live URLs',
    async () => {
      if (!(await hasDockerDaemon())) {
        return
      }

      const sample = await prepareSample('db-and-server', { initWithConfig: true })
      const branch = `feature-${'a'.repeat(80)}`
      const expectedLabel = formatHostnameLabel(branch)
      const worktreePath = await createWorktree(sample.dir, branch)

      try {
        await execPortAsync(['up'], worktreePath)

        const urlsResult = await execPortAsync(['urls'], worktreePath)
        expect(urlsResult.stderr).toContain(`http://app.${expectedLabel}.port`)
        expect(urlsResult.stderr).toContain(`http://${expectedLabel}.port:3000`)

        const response = await pollUntilReady(`http://${expectedLabel}.port:3000`)
        expect(response.status).toBe(200)
      } finally {
        await safeDown(worktreePath)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'warns when two active branches truncate to the same hostname label',
    async () => {
      if (!(await hasDockerDaemon())) {
        return
      }

      const sample = await prepareSample('db-and-server', { initWithConfig: true })
      const sharedPrefix = `feature-${'b'.repeat(80)}`
      const branchA = `${sharedPrefix}-one`
      const branchB = `${sharedPrefix}-two`
      const label = formatHostnameLabel(branchA)
      const worktreeAPath = await createWorktree(sample.dir, branchA)
      const worktreeBPath = await createWorktree(sample.dir, branchB)

      try {
        await execPortAsync(['up'], worktreeAPath)
        const secondUp = await execPortAsync(['up'], worktreeBPath)

        expect(secondUp.stderr).toContain(
          `Hostname label "${label}" already exists for another active service. URLs may collide.`
        )
      } finally {
        await safeDown(worktreeAPath)
        await safeDown(worktreeBPath)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )
})

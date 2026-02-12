import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, test } from 'vitest'
import { execAsync } from '../src/lib/exec'
import { prepareSample } from './utils'
import { cleanupTaskRuntime, runPortCommand, waitForTaskByTitle } from './taskIntegrationHelpers'

const PATCH_MARKER = '// applied-from-task-artifact'
const INTEGRATION_TIMEOUT = 60000

async function seedPatchArtifactForTask(repoRoot: string, taskId: string): Promise<void> {
  const targetFile = join(repoRoot, 'index.ts')
  const artifactPatchPath = join(repoRoot, '.port', 'jobs', 'artifacts', taskId, 'changes.patch')

  const original = await readFile(targetFile, 'utf-8')
  await writeFile(targetFile, `${original}\n${PATCH_MARKER}\n`)

  const { stdout: patch } = await execAsync('git diff --binary', { cwd: repoRoot })
  expect(patch.length).toBeGreaterThan(0)

  await execAsync('git checkout -- index.ts', { cwd: repoRoot })
  await writeFile(artifactPatchPath, patch)
}

describe('task apply integration', () => {
  test(
    'applies task output into a clean worktree',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await execAsync('git add . && git commit -m "baseline"', { cwd: sample.dir })

        await runPortCommand(['task', 'start', 'apply-clean'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'apply-clean')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '30'], sample.dir)

        await seedPatchArtifactForTask(sample.dir, task.id)

        const { stdout: cleanStatus } = await execAsync('git status --porcelain', {
          cwd: sample.dir,
        })
        expect(cleanStatus.trim()).toBe('')

        const apply = await runPortCommand(
          ['task', 'apply', task.id, '--method', 'patch'],
          sample.dir
        )
        expect(apply.stdout).toContain('Applied task')

        const updated = await readFile(join(sample.dir, 'index.ts'), 'utf-8')
        expect(updated).toContain(PATCH_MARKER)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'fails to apply task output when local worktree is dirty',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await execAsync('git add . && git commit -m "baseline"', { cwd: sample.dir })

        await runPortCommand(['task', 'start', 'apply-dirty'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'apply-dirty')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '30'], sample.dir)

        await seedPatchArtifactForTask(sample.dir, task.id)
        await writeFile(join(sample.dir, 'UNCOMMITTED.txt'), 'dirty\n')

        const apply = await runPortCommand(
          ['task', 'apply', task.id, '--method', 'patch'],
          sample.dir,
          { allowFailure: true }
        )

        expect(apply.code).not.toBe(0)
        expect(apply.stderr).toContain('Working tree is not clean')

        const target = await readFile(join(sample.dir, 'index.ts'), 'utf-8')
        expect(target).not.toContain(PATCH_MARKER)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )
})

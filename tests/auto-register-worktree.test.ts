import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'vitest'
import { execAsync } from '../src/lib/exec'
import type { Project, Registry } from '../src/types'
import { execPortAsync, prepareSample } from './utils'
import { useIsolatedPortGlobalDir } from './isolatedGlobalDir'

const TIMEOUT = 60_000

/**
 * Create an unmanaged worktree under .port/trees/<name> using raw git, so that
 * the global registry has no entry for it. This is the precondition the
 * auto-register feature is designed to handle.
 */
async function createUnmanagedWorktree(
  repoDir: string,
  branch: string,
  worktreeName = branch
): Promise<string> {
  const worktreePath = join(repoDir, '.port/trees', worktreeName)
  await execAsync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: repoDir })
  return worktreePath
}

/**
 * Read the global registry directly from disk via the current PORT_GLOBAL_DIR.
 *
 * We can't import getProject() from '../src/lib/registry' because that module
 * caches GLOBAL_PORT_DIR at import time (from the shared globalSetup dir),
 * which doesn't reflect the isolated dir set up by useIsolatedPortGlobalDir.
 * Reading the file directly always reflects the active env var.
 */
function readRegistry(globalDir: string): Registry {
  const file = join(globalDir, 'registry.json')
  if (!existsSync(file)) {
    return { projects: [], hostServices: [] }
  }
  return JSON.parse(readFileSync(file, 'utf-8')) as Registry
}

function findProject(globalDir: string, repo: string, branch: string): Project | undefined {
  return readRegistry(globalDir).projects.find(p => p.repo === repo && p.branch === branch)
}

/**
 * Seed the isolated registry with a project entry so we can verify
 * auto-register respects existing entries.
 */
function writeRegistry(globalDir: string, registry: Registry): void {
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true })
  }
  writeFileSync(join(globalDir, 'registry.json'), JSON.stringify(registry, null, 2))
}

describe('auto-register current worktree', () => {
  const isolated = useIsolatedPortGlobalDir('port-auto-register-e2e')

  test(
    'running a worktree-aware command in an unmanaged worktree registers it',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        const repoRoot = realpathSync(sample.dir)
        const worktreePath = await createUnmanagedWorktree(sample.dir, 'auto-register-happy')

        // Sanity check: not registered before we invoke port
        expect(findProject(isolated.getDir(), repoRoot, 'auto-register-happy')).toBeUndefined()

        await execPortAsync(['status'], worktreePath)

        const project = findProject(isolated.getDir(), repoRoot, 'auto-register-happy')
        expect(project).toBeDefined()
        expect(project?.ports).toEqual([])
      } finally {
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'leaves an already-registered worktree untouched (idempotent)',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        const repoRoot = realpathSync(sample.dir)
        const worktreePath = await createUnmanagedWorktree(sample.dir, 'auto-register-idempotent')

        // Pre-register with non-empty ports to detect any overwrite by auto-register.
        writeRegistry(isolated.getDir(), {
          projects: [{ repo: repoRoot, branch: 'auto-register-idempotent', ports: [3000] }],
          hostServices: [],
        })

        await execPortAsync(['status'], worktreePath)

        const project = findProject(isolated.getDir(), repoRoot, 'auto-register-idempotent')
        expect(project).toBeDefined()
        // Ports must remain [3000]; auto-register must not overwrite with [].
        expect(project?.ports).toEqual([3000])
      } finally {
        await sample.cleanup()
      }
    },
    TIMEOUT
  )

  test(
    'running a worktree-aware command in the main repo does not register the repo',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        const repoRoot = realpathSync(sample.dir)

        await execPortAsync(['status'], sample.dir)

        const projects = readRegistry(isolated.getDir()).projects.filter(p => p.repo === repoRoot)
        expect(projects).toEqual([])
      } finally {
        await sample.cleanup()
      }
    },
    TIMEOUT
  )
})

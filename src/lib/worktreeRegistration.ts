import { CliError } from './cli.ts'
import { configExists, getRegistrationLockPath, loadConfig } from './config.ts'
import { getCurrentBranch } from './git.ts'
import { hookExists, runPostCreateHook } from './hooks.ts'
import { isProjectRegistered, registerProject } from './registry.ts'
import { sanitizeBranchName } from './sanitize.ts'
import { withFileLock } from './state.ts'
import { detectWorktree } from './worktree.ts'
import * as output from './output.ts'

/**
 * Mark a worktree as registered in the global registry.
 *
 * Serialized (per repo+branch) with the same lock used by
 * `ensureCurrentWorktreeRegistered`, so a `port enter` in flight and a
 * `port` command that races it in the same brand-new worktree cannot both
 * decide the worktree is unregistered and both re-run the post-create hook.
 *
 * Call this right after a worktree is created (and its post-create hook has
 * run) so the opportunistic registration check below never sees a
 * Port-created worktree as "unmanaged".
 */
export async function markWorktreeRegistered(repoRoot: string, branch: string): Promise<void> {
  try {
    await withFileLock(getRegistrationLockPath(repoRoot, branch), async () => {
      await registerProject(repoRoot, branch, [])
    })
  } catch {
    // Best effort — a failure here just means the next `port` command will
    // opportunistically retry registration.
  }
}

/**
 * Opportunistically register the current worktree when the user runs any
 * port command inside an unmanaged worktree.
 *
 * The "is it registered" check, the post-create hook run, and the eventual
 * registry write are all performed inside a single lock (scoped per
 * repo+branch) so that two `port` commands running concurrently in the same
 * worktree cannot both observe "not registered yet" and both re-run the
 * post-create hook.
 */
export async function ensureCurrentWorktreeRegistered(): Promise<void> {
  let worktreeInfo

  try {
    worktreeInfo = detectWorktree()
  } catch {
    return
  }

  if (worktreeInfo.isMainRepo) {
    return
  }

  if (!configExists(worktreeInfo.repoRoot)) {
    return
  }

  let rawBranch: string
  try {
    rawBranch = await getCurrentBranch(worktreeInfo.worktreePath)
  } catch {
    return
  }

  if (rawBranch === 'HEAD') {
    return
  }

  const branch = sanitizeBranchName(rawBranch)
  const { repoRoot, worktreePath } = worktreeInfo

  try {
    await withFileLock(getRegistrationLockPath(repoRoot, branch), async () => {
      const alreadyRegistered = await isProjectRegistered(repoRoot, branch)
      if (alreadyRegistered) {
        return
      }

      const hasPostCreateHook = await hookExists(repoRoot, 'post-create')

      if (hasPostCreateHook) {
        const config = await loadConfig(repoRoot)

        const result = await runPostCreateHook({
          repoRoot,
          worktreePath,
          branch,
          domain: config.domain,
        })

        if (!result.success) {
          output.error(`Post-create hook failed (exit code ${result.exitCode})`)
          throw new CliError(`Post-create hook failed (exit code ${result.exitCode})`, {
            exitCode: result.exitCode,
            alreadyReported: true,
          })
        }
      }

      await registerProject(repoRoot, branch, [])
    })
  } catch (error) {
    if (error instanceof CliError) {
      throw error
    }
    // Opportunistic registration/hook-detection failures should never block
    // the underlying port command from proceeding.
  }
}

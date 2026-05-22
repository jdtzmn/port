import { CliError } from './cli.ts'
import { configExists } from './config.ts'
import { getCurrentBranch } from './git.ts'
import { hookExists, runPostCreateHook } from './hooks.ts'
import { isProjectRegistered, registerProject } from './registry.ts'
import { sanitizeBranchName } from './sanitize.ts'
import { detectWorktree } from './worktree.ts'
import * as output from './output.ts'

/**
 * Opportunistically register the current worktree when the user runs any
 * port command inside an unmanaged worktree.
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

  let alreadyRegistered: boolean
  try {
    alreadyRegistered = await isProjectRegistered(worktreeInfo.repoRoot, branch)
  } catch {
    return
  }

  if (alreadyRegistered) {
    return
  }

  let hasPostCreateHook = false
  try {
    hasPostCreateHook = await hookExists(worktreeInfo.repoRoot, 'post-create')
  } catch {
    return
  }

  if (hasPostCreateHook) {
    const result = await runPostCreateHook({
      repoRoot: worktreeInfo.repoRoot,
      worktreePath: worktreeInfo.worktreePath,
      branch,
    })

    if (!result.success) {
      output.error(`Post-create hook failed (exit code ${result.exitCode})`)
      throw new CliError(`Post-create hook failed (exit code ${result.exitCode})`, {
        exitCode: result.exitCode,
        alreadyReported: true,
      })
    }
  }

  try {
    await registerProject(worktreeInfo.repoRoot, branch, [])
  } catch {
    return
  }
}

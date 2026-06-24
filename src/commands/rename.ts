import { detectWorktree, worktreeExists } from '../lib/worktree.ts'
import { ensurePortRuntimeDir, loadConfigOrDefault, getComposeFile } from '../lib/config.ts'
import { getCurrentBranch, branchExists, renameWorktree } from '../lib/git.ts'
import {
  branchHasRunningServices,
  rewriteRegistryForRename,
  rewriteHostServicesForRename,
} from '../lib/registry.ts'
import {
  parseComposeFile,
  writeOverrideFile,
  buildProjectName as getProjectName,
} from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import * as output from '../lib/output.ts'
import { failWithError } from '../lib/cli.ts'
import { buildEnterCommands, getEvalContext, writeEvalFile } from '../lib/shell.ts'

/**
 * Rename the current worktree and keep Port state aligned.
 */
export async function rename(newBranch: string): Promise<void> {
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch {
    failWithError('Not in a git repository')
  }

  if (worktreeInfo.isMainRepo) {
    failWithError('Run `port rename` from inside a worktree.')
  }

  const repoRoot = worktreeInfo.repoRoot
  await ensurePortRuntimeDir(repoRoot)

  const config = await loadConfigOrDefault(repoRoot)
  const composeFile = getComposeFile(config)
  const oldBranch = await getCurrentBranch(worktreeInfo.worktreePath)
  const oldWorktreeName = worktreeInfo.name
  const sanitizedNewBranch = sanitizeBranchName(newBranch)

  if (sanitizedNewBranch !== newBranch) {
    output.dim(`Branch name sanitized: ${newBranch} → ${sanitizedNewBranch}`)
  }

  if (sanitizedNewBranch === oldWorktreeName && newBranch === oldBranch) {
    output.info('Worktree already has that name')
    return
  }

  output.info('Checking for running services...')

  if (await branchHasRunningServices(repoRoot, oldWorktreeName, composeFile, config.domain)) {
    failWithError('Stop running services before renaming this worktree.')
  }

  if (newBranch !== oldBranch && (await branchExists(repoRoot, newBranch))) {
    failWithError(`Branch already exists: ${newBranch}`)
  }

  if (sanitizedNewBranch !== oldWorktreeName && worktreeExists(repoRoot, newBranch)) {
    failWithError(`Worktree already exists: ${sanitizedNewBranch}`)
  }

  const newWorktreePath = await renameWorktree(repoRoot, oldBranch, newBranch)

  await rewriteRegistryForRename(repoRoot, oldWorktreeName, sanitizedNewBranch)
  await rewriteHostServicesForRename(repoRoot, oldWorktreeName, sanitizedNewBranch)

  try {
    const parsedCompose = await parseComposeFile(newWorktreePath, composeFile)
    const projectName = getProjectName(repoRoot, sanitizedNewBranch)
    await writeOverrideFile(
      newWorktreePath,
      parsedCompose,
      sanitizedNewBranch,
      config.domain,
      projectName
    )
  } catch {
    output.dim('Could not refresh .port/override.yml after rename')
  }

  const evalCtx = getEvalContext()
  if (evalCtx) {
    const commands = buildEnterCommands(
      evalCtx.shell,
      newWorktreePath,
      sanitizedNewBranch,
      repoRoot
    )
    writeEvalFile(commands, evalCtx.evalFile)
  } else {
    output.newline()
    output.success(
      `Renamed worktree ${output.branch(oldWorktreeName)} → ${output.branch(sanitizedNewBranch)}`
    )
    output.newline()
    output.info(`Run: cd ${newWorktreePath}`)
  }
}

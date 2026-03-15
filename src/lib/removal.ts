import { existsSync } from 'fs'
import {
  archiveBranch,
  deleteLocalBranch,
  pruneWorktrees,
  removeWorktree,
  removeWorktreeAtPath,
} from './git.ts'
import { unregisterProject } from './registry.ts'
import { runCompose, getProjectName } from './compose.ts'
import { sanitizeBranchName } from './sanitize.ts'
import { getWorktreePath } from './worktree.ts'
import * as output from './output.ts'

export interface RemovalContext {
  /** Absolute path to repo root */
  repoRoot: string
  /** Compose file relative path */
  composeFile: string
  /** Domain suffix for Traefik routing */
  domain: string
}

export interface RemoveWorktreeOptions {
  /** How to handle the local branch after worktree removal */
  branchAction: 'archive' | 'delete' | 'keep'
  /** Whether the worktree is at a non-standard path */
  nonStandardPath?: string
  /** Skip stopping services (used by batched prune workflows) */
  skipServices?: boolean
  /** Suppress per-step output (for batch operations) */
  quiet?: boolean
}

export interface RemoveWorktreeResult {
  success: boolean
  error?: string
  archivedBranch?: string
}

interface StopWorktreeServicesOptions {
  /** Whether the worktree is at a non-standard path */
  nonStandardPath?: string
  /** Suppress output while stopping services */
  quiet?: boolean
}

/**
 * Stop docker-compose services for a worktree.
 *
 * Non-zero compose exit codes are treated as non-fatal to match existing
 * remove semantics.
 */
export async function stopWorktreeServices(
  ctx: RemovalContext,
  branch: string,
  options: StopWorktreeServicesOptions = {}
): Promise<void> {
  const sanitized = sanitizeBranchName(branch)
  const worktreePath = options.nonStandardPath ?? getWorktreePath(ctx.repoRoot, branch)
  const worktreePathExists = existsSync(worktreePath)
  const log = options.quiet ? () => {} : output.info

  if (!worktreePathExists) {
    return
  }

  const projectName = getProjectName(ctx.repoRoot, sanitized)
  log(`Stopping services in ${output.branch(sanitized)}...`)

  const { exitCode } = await runCompose(worktreePath, ctx.composeFile, projectName, ['down'], {
    repoRoot: ctx.repoRoot,
    branch: sanitized,
    domain: ctx.domain,
  })

  if (exitCode !== 0 && !options.quiet) {
    output.warn('Failed to stop services')
  }
}

/**
 * Remove a single worktree: stop services, remove git worktree,
 * unregister from global registry, and handle the local branch.
 *
 * This is the shared removal pipeline used by both `port remove` and
 * `port prune`.
 *
 * @param ctx - Repository context (root, compose file, domain)
 * @param branch - The branch name (unsanitized is fine — will be sanitized)
 * @param options - Removal options
 * @returns Result indicating success/failure
 */
export async function removeWorktreeAndCleanup(
  ctx: RemovalContext,
  branch: string,
  options: RemoveWorktreeOptions
): Promise<RemoveWorktreeResult> {
  const sanitized = sanitizeBranchName(branch)
  const worktreePath = options.nonStandardPath ?? getWorktreePath(ctx.repoRoot, branch)
  const worktreePathExists = existsSync(worktreePath)

  // 1. Stop Docker services
  if (!options.skipServices) {
    try {
      await stopWorktreeServices(ctx, branch, {
        nonStandardPath: options.nonStandardPath,
        quiet: options.quiet,
      })
    } catch (error) {
      if (!options.quiet) {
        output.warn(`Failed to stop services: ${error}`)
      }
    }
  }

  // 2. Remove git worktree
  try {
    if (worktreePathExists) {
      if (options.nonStandardPath) {
        await removeWorktreeAtPath(ctx.repoRoot, worktreePath, true)
      } else {
        await removeWorktree(ctx.repoRoot, branch, true)
      }
    } else {
      await pruneWorktrees(ctx.repoRoot)
    }
  } catch (error) {
    return { success: false, error: `Failed to remove worktree: ${error}` }
  }

  // 3. Unregister from global registry
  await unregisterProject(ctx.repoRoot, sanitized)

  // 4. Handle local branch
  let archivedBranch: string | undefined
  if (options.branchAction === 'archive') {
    try {
      const archived = await archiveBranch(ctx.repoRoot, branch)
      if (archived) archivedBranch = archived
    } catch {
      // Non-fatal — worktree is already removed
    }
  } else if (options.branchAction === 'delete') {
    try {
      await deleteLocalBranch(ctx.repoRoot, branch, true)
    } catch {
      // Non-fatal — branch may already be gone
    }
  }

  return { success: true, archivedBranch }
}

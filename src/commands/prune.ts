import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, getComposeFile, ensurePortRuntimeDir } from '../lib/config.ts'
import {
  getDefaultBranch,
  getMergedBranches,
  getGoneBranches,
  fetchAndPrune,
  listWorktrees,
} from '../lib/git.ts'
import { isGhAvailable, getMergedPrBranches, type MergedPrInfo } from '../lib/github.ts'
import { removeWorktreeAndCleanup, stopWorktreeServices } from '../lib/removal.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import { failWithError } from '../lib/cli.ts'
import * as output from '../lib/output.ts'

interface PruneOptions {
  dryRun?: boolean
  force?: boolean
  noFetch?: boolean
  base?: string
}

/** Why a branch was identified as safe to remove */
type PruneReason = 'merged' | 'gone' | 'pr-merged'

interface PruneCandidate {
  /** Original git branch name */
  branch: string
  /** Sanitized name (matches worktree directory) */
  sanitized: string
  /** Why this branch is considered safe to remove */
  reason: PruneReason
  /** PR metadata if detected via gh */
  pr?: MergedPrInfo
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length))
  if (safeConcurrency === 0) {
    return []
  }

  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1

      if (index >= items.length) {
        return
      }

      results[index] = await worker(items[index] as T)
    }
  })

  await Promise.all(runners)
  return results
}

function formatReason(candidate: PruneCandidate): string {
  switch (candidate.reason) {
    case 'merged':
      return 'merged into base'
    case 'gone':
      return 'upstream deleted'
    case 'pr-merged': {
      if (candidate.pr) {
        const ago = formatTimeAgo(candidate.pr.mergedAt)
        return `PR #${candidate.pr.number} merged ${ago}`
      }
      return 'PR merged'
    }
  }
}

function formatTimeAgo(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diffMs = now - then

  const minutes = Math.floor(diffMs / 60_000)
  const hours = Math.floor(diffMs / 3_600_000)
  const days = Math.floor(diffMs / 86_400_000)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)

  if (months > 0) return `${months}mo ago`
  if (weeks > 0) return `${weeks}w ago`
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

/**
 * Detect and remove worktrees whose branches have been merged.
 *
 * Uses a layered detection strategy:
 * 1. `git branch --merged <base>` for reachability
 * 2. `git branch -vv` for "gone" upstream tracking refs
 * 3. `gh pr list --state merged` for squash-merged PRs (optional)
 */
export async function prune(options: PruneOptions = {}): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }

  await ensurePortRuntimeDir(repoRoot)

  // 1. Fetch and prune remote refs
  if (!options.noFetch) {
    output.info('Fetching remote state...')
    await fetchAndPrune(repoRoot)
  }

  output.info('Detecting merged worktrees...')

  // 2. Determine the base branch
  const baseBranch = options.base ?? (await getDefaultBranch(repoRoot))

  // 3. Get all worktrees managed by port (excluding main repo)
  const worktrees = await listWorktrees(repoRoot)
  const portWorktrees = worktrees.filter(wt => !wt.isMain)

  if (portWorktrees.length === 0) {
    output.info('No worktrees to prune.')
    return
  }

  // Build a set of worktree branch names for fast lookup
  const worktreeBranches = new Set(portWorktrees.map(wt => wt.branch))

  // 4. Run detection strategies in parallel
  const [mergedBranches, goneBranches, ghAvailable] = await Promise.all([
    getMergedBranches(repoRoot, baseBranch),
    getGoneBranches(repoRoot, { fetch: false }), // Already fetched above
    isGhAvailable(),
  ])

  // Optionally fetch PR metadata
  let prBranches = new Map<string, MergedPrInfo>()
  if (ghAvailable) {
    prBranches = await getMergedPrBranches(repoRoot)
  }

  // 5. Build candidates — only include branches that have worktrees
  const candidateMap = new Map<string, PruneCandidate>()

  for (const branch of mergedBranches) {
    if (worktreeBranches.has(branch) && branch !== baseBranch) {
      candidateMap.set(branch, {
        branch,
        sanitized: sanitizeBranchName(branch),
        reason: 'merged',
      })
    }
  }

  for (const branch of goneBranches) {
    if (worktreeBranches.has(branch) && !candidateMap.has(branch)) {
      candidateMap.set(branch, {
        branch,
        sanitized: sanitizeBranchName(branch),
        reason: 'gone',
      })
    }
  }

  // Check PR metadata for worktree branches not yet identified
  for (const wt of portWorktrees) {
    if (!candidateMap.has(wt.branch)) {
      const prInfo = prBranches.get(wt.branch)
      if (prInfo) {
        candidateMap.set(wt.branch, {
          branch: wt.branch,
          sanitized: sanitizeBranchName(wt.branch),
          reason: 'pr-merged',
          pr: prInfo,
        })
      }
    }
  }

  const candidates = Array.from(candidateMap.values())

  if (candidates.length === 0) {
    output.success('No merged worktrees found. Everything is clean.')
    return
  }

  // 6. Display candidates
  output.newline()
  output.header(
    `Found ${candidates.length} worktree${candidates.length === 1 ? '' : 's'} safe to remove:`
  )
  output.newline()

  for (const candidate of candidates) {
    const name = output.branch(candidate.sanitized)
    const reason = formatReason(candidate)
    console.error(`  ${name}  ${reason}`)
  }

  output.newline()

  // 7. Dry run — stop here
  if (options.dryRun) {
    output.dim('Dry run — no changes made. Re-run without --dry-run to remove.')
    return
  }

  // 8. Confirm
  if (!options.force) {
    const { confirmPrune } = await inquirer.prompt<{ confirmPrune: boolean }>([
      {
        type: 'confirm',
        name: 'confirmPrune',
        message: `Remove ${candidates.length} worktree${candidates.length === 1 ? '' : 's'}?`,
        default: false,
      },
    ])

    if (!confirmPrune) {
      output.info('Prune cancelled')
      return
    }
  }

  // 9. Remove each candidate
  const config = await loadConfigOrDefault(repoRoot)
  const composeFile = getComposeFile(config)
  const ctx = { repoRoot, composeFile, domain: config.domain }

  let removedCount = 0
  let failedCount = 0

  // 9. Stop services in parallel first (most expensive part)
  output.info('Stopping services for prune candidates...')
  const stopResults = await mapWithConcurrency(candidates, 3, async candidate => {
    try {
      await stopWorktreeServices(ctx, candidate.branch, { quiet: true })
      return { candidate, ok: true as const }
    } catch (error) {
      return {
        candidate,
        ok: false as const,
        error: `Failed to stop services: ${error}`,
      }
    }
  })

  for (const stopResult of stopResults) {
    if (!stopResult.ok) {
      output.warn(
        `Proceeding despite service shutdown failure for ${output.branch(stopResult.candidate.sanitized)}: ${stopResult.error}`
      )
    }
  }

  // 10. Remove each candidate (serial to avoid git lock contention)
  for (const candidate of candidates) {
    output.newline()
    output.info(`Removing ${output.branch(candidate.sanitized)}...`)

    const result = await removeWorktreeAndCleanup(ctx, candidate.branch, {
      branchAction: 'archive',
      skipServices: true,
      quiet: true,
    })

    if (result.success) {
      removedCount++
      output.success(`Removed ${output.branch(candidate.sanitized)}`)
    } else {
      failedCount++
      output.warn(`Failed to remove ${output.branch(candidate.sanitized)}: ${result.error}`)
    }
  }

  // 11. Summary
  output.newline()
  if (failedCount > 0) {
    output.warn(
      `Pruned ${removedCount} worktree${removedCount === 1 ? '' : 's'}; ${failedCount} failed.`
    )
  } else {
    output.success(`Pruned ${removedCount} worktree${removedCount === 1 ? '' : 's'}.`)
  }

  if (removedCount > 0) {
    output.dim('Branches archived locally. Run "port cleanup" to permanently delete them.')
  }
}

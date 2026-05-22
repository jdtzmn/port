import { getDefaultBranch, getGoneBranches, getMergedBranches, listWorktrees } from './git.ts'
import { getMergedPrBranches, isGhAvailable, type MergedPrInfo } from './github.ts'
import { sanitizeBranchName } from './sanitize.ts'

export const STALE_WORKTREE_WARNING_THRESHOLD = 10
export const STALE_WORKTREE_EXTREME_THRESHOLD = 25

export type StaleWorktreeReason = 'merged' | 'gone' | 'pr-merged'

export interface StaleWorktreeCandidate {
  branch: string
  sanitized: string
  reason: StaleWorktreeReason
  pr?: MergedPrInfo
}

export function formatStaleWorktreeWarning(count: number): string {
  return `You have ${count} stale port worktrees. Consider running port prune.`
}

export async function getStaleWorktreeCandidates(
  repoRoot: string,
  options: { baseBranch?: string } = {}
): Promise<StaleWorktreeCandidate[]> {
  try {
    const baseBranch = options.baseBranch ?? (await getDefaultBranch(repoRoot))
    const worktrees = await listWorktrees(repoRoot)
    const worktreeBranches = new Set(worktrees.filter(wt => !wt.isMain).map(wt => wt.branch))

    const [mergedBranches, goneBranches, ghAvailable] = await Promise.all([
      getMergedBranches(repoRoot, baseBranch),
      getGoneBranches(repoRoot, { fetch: false }),
      isGhAvailable(),
    ])

    let prBranches = new Map<string, MergedPrInfo>()
    if (ghAvailable) {
      prBranches = await getMergedPrBranches(repoRoot)
    }

    const candidateMap = new Map<string, StaleWorktreeCandidate>()

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

    for (const branch of worktreeBranches) {
      if (candidateMap.has(branch)) {
        continue
      }

      const prInfo = prBranches.get(branch)
      if (prInfo) {
        candidateMap.set(branch, {
          branch,
          sanitized: sanitizeBranchName(branch),
          reason: 'pr-merged',
          pr: prInfo,
        })
      }
    }

    return Array.from(candidateMap.values())
  } catch {
    return []
  }
}

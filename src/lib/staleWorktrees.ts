import { createHash } from 'crypto'
import { mkdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { getDefaultBranch, getGoneBranches, getMergedBranches, listWorktrees } from './git.ts'
import { getMergedPrBranches, isGhAvailable, type MergedPrInfo } from './github.ts'
import { GLOBAL_PORT_DIR } from './registry.ts'
import { sanitizeBranchName } from './sanitize.ts'
import { writeFileAtomic } from './state.ts'
import { measureCommandPhase } from './commandProfile.ts'

export const STALE_WORKTREE_WARNING_THRESHOLD = 10
export const STALE_WORKTREE_EXTREME_THRESHOLD = 25
export const STALE_WORKTREE_CACHE_TTL_MS = 30_000

const STALE_WORKTREE_CACHE_DIR = join(GLOBAL_PORT_DIR, 'cache', 'stale-worktrees')

export type StaleWorktreeReason = 'merged' | 'gone' | 'pr-merged'

export interface StaleWorktreeCandidate {
  branch: string
  sanitized: string
  reason: StaleWorktreeReason
  pr?: MergedPrInfo
}

interface StaleWorktreeSnapshot {
  createdAt: number
  candidates: StaleWorktreeCandidate[]
}

interface StaleWorktreeOptions {
  baseBranch?: string
  fresh?: boolean
}

function getSnapshotPath(repoRoot: string): string {
  const key = createHash('sha256').update(repoRoot).digest('hex')
  return join(STALE_WORKTREE_CACHE_DIR, `${key}.json`)
}

function isStaleWorktreeCandidate(value: unknown): value is StaleWorktreeCandidate {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.branch === 'string' &&
    typeof candidate.sanitized === 'string' &&
    (candidate.reason === 'merged' ||
      candidate.reason === 'gone' ||
      candidate.reason === 'pr-merged')
  )
}

async function readSnapshot(repoRoot: string): Promise<StaleWorktreeCandidate[] | null> {
  try {
    const snapshot = JSON.parse(
      await readFile(getSnapshotPath(repoRoot), 'utf-8')
    ) as Partial<StaleWorktreeSnapshot>
    const createdAt = snapshot.createdAt
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null

    const ageMs = Date.now() - createdAt
    if (
      ageMs < 0 ||
      ageMs >= STALE_WORKTREE_CACHE_TTL_MS ||
      !Array.isArray(snapshot.candidates) ||
      !snapshot.candidates.every(isStaleWorktreeCandidate)
    ) {
      return null
    }

    return snapshot.candidates
  } catch {
    return null
  }
}

/** Return a valid stale-worktree snapshot without running Git or GitHub discovery. */
export function getCachedStaleWorktreeCandidates(
  repoRoot: string
): Promise<StaleWorktreeCandidate[] | null> {
  return readSnapshot(repoRoot)
}

async function writeSnapshot(
  repoRoot: string,
  candidates: StaleWorktreeCandidate[]
): Promise<void> {
  try {
    await mkdir(STALE_WORKTREE_CACHE_DIR, { recursive: true })
    await writeFileAtomic(
      getSnapshotPath(repoRoot),
      JSON.stringify({ createdAt: Date.now(), candidates })
    )
  } catch {
    // Caching is opportunistic; failed cache I/O must never hide stale worktrees.
  }
}

/** Remove cached stale-worktree results after a worktree mutation. */
export async function invalidateStaleWorktreeCache(repoRoot: string): Promise<void> {
  try {
    await unlink(getSnapshotPath(repoRoot))
  } catch {
    // A missing or unavailable cache is already equivalent to an invalidated cache.
  }
}

export function formatStaleWorktreeWarning(count: number): string {
  return `You have ${count} stale port worktrees. Consider running port prune.`
}

export interface StaleWorktreeCandidatesResult {
  candidates: StaleWorktreeCandidate[]
  degraded: boolean
}

export async function getStaleWorktreeCandidatesWithStatus(
  repoRoot: string,
  options: StaleWorktreeOptions = {}
): Promise<StaleWorktreeCandidatesResult> {
  const useCache = !options.fresh && options.baseBranch === undefined
  if (useCache) {
    const cached = await readSnapshot(repoRoot)
    if (cached) return { candidates: cached, degraded: false }
  }

  try {
    const baseBranch =
      options.baseBranch ??
      (await measureCommandPhase('git.default-branch', () => getDefaultBranch(repoRoot)))
    const worktrees = await measureCommandPhase('git.worktrees', () => listWorktrees(repoRoot))
    const worktreeBranches = new Set(worktrees.filter(wt => !wt.isMain).map(wt => wt.branch))

    const [mergedBranches, goneBranches, ghAvailable] = await Promise.all([
      measureCommandPhase('git.merged-branches', () => getMergedBranches(repoRoot, baseBranch)),
      measureCommandPhase('git.gone-branches', () => getGoneBranches(repoRoot, { fetch: false })),
      measureCommandPhase('github.availability', () => isGhAvailable()),
    ])

    let prBranches = new Map<string, MergedPrInfo>()
    if (ghAvailable) {
      prBranches = await measureCommandPhase('github.merged-prs', () =>
        getMergedPrBranches(repoRoot)
      )
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
      if (candidateMap.has(branch)) continue

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

    const candidates = Array.from(candidateMap.values())
    if (useCache) await writeSnapshot(repoRoot, candidates)
    return { candidates, degraded: false }
  } catch {
    return { candidates: [], degraded: true }
  }
}

export async function getStaleWorktreeCandidates(
  repoRoot: string,
  options: StaleWorktreeOptions = {}
): Promise<StaleWorktreeCandidate[]> {
  return (await getStaleWorktreeCandidatesWithStatus(repoRoot, options)).candidates
}

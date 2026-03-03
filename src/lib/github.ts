import { execAsync } from './exec.ts'

/**
 * Metadata for a merged pull request
 */
export interface MergedPrInfo {
  /** PR number */
  number: number
  /** Branch name the PR was opened from */
  headRefName: string
  /** ISO timestamp of when the PR was merged */
  mergedAt: string
}

/** Cached result so we only probe once per CLI invocation */
let ghAvailableCache: boolean | null = null

/**
 * Check whether the GitHub CLI (`gh`) is installed and authenticated.
 *
 * The result is cached for the lifetime of the process.
 */
export async function isGhAvailable(): Promise<boolean> {
  if (ghAvailableCache !== null) return ghAvailableCache

  try {
    await execAsync('gh auth status', { timeout: 5000 })
    ghAvailableCache = true
  } catch {
    ghAvailableCache = false
  }

  return ghAvailableCache
}

/**
 * Fetch all merged PR branch names from GitHub in a single API call.
 *
 * Returns a Map keyed by branch name for O(1) lookups. Only works when
 * `gh` is installed and authenticated — call {@link isGhAvailable} first.
 *
 * @param repoRoot - The repository root path (used as cwd for gh)
 * @param limit - Maximum number of merged PRs to fetch (default: 500)
 * @returns Map of branch name to merged PR info
 */
export async function getMergedPrBranches(
  repoRoot: string,
  limit: number = 500
): Promise<Map<string, MergedPrInfo>> {
  const map = new Map<string, MergedPrInfo>()

  try {
    const { stdout } = await execAsync(
      `gh pr list --state merged --limit ${limit} --json number,headRefName,mergedAt`,
      { cwd: repoRoot, timeout: 15000 }
    )

    const prs = JSON.parse(stdout) as MergedPrInfo[]

    for (const pr of prs) {
      if (pr.headRefName) {
        map.set(pr.headRefName, pr)
      }
    }
  } catch {
    // gh not available or API failure — return empty map
  }

  return map
}

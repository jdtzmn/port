import { existsSync, readdirSync } from 'fs'
import { detectWorktree } from '../lib/worktree.ts'
import { getTreesDir } from '../lib/config.ts'
import { sanitizeBranchName, sanitizeFolderName } from '../lib/sanitize.ts'
import { listWorktrees } from '../lib/git.ts'

/**
 * Get worktree names from the .port/trees/ directory without any expensive
 * Docker or Traefik checks. Returns an empty array if not in a port repo.
 */
export function getWorktreeNames(repoRoot: string): string[] {
  const names: string[] = []

  // Add the main repo itself (same logic as collectWorktreeStatuses)
  const repoName = sanitizeFolderName(repoRoot.split('/').pop() ?? 'main')
  names.push(repoName)

  const treesDir = getTreesDir(repoRoot)
  if (!existsSync(treesDir)) {
    return names
  }

  const entries = readdirSync(treesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      names.push(entry.name)
    }
  }

  return names
}

/**
 * Get both sanitized directory names and original git branch names for all
 * worktrees. Uses `git worktree list --porcelain` to recover original branch
 * names that may differ from the sanitized directory name (e.g. a branch
 * named `jacob/test/sanitation` lives in directory `jacob-test-sanitation`).
 *
 * Returns a deduplicated array — if a branch name matches its sanitized form,
 * it only appears once.
 */
export async function getWorktreeNamesWithOriginals(repoRoot: string): Promise<string[]> {
  const names = new Set<string>()

  // Start with the fast filesystem-based names
  for (const name of getWorktreeNames(repoRoot)) {
    names.add(name)
  }

  // Enrich with original branch names from git
  try {
    const treesDir = getTreesDir(repoRoot)
    const worktrees = await listWorktrees(repoRoot)
    for (const wt of worktrees) {
      // Only include worktrees managed by port (under .port/trees/)
      if (wt.path.startsWith(treesDir + '/') || wt.path === treesDir) {
        // Add the original branch name if it differs from the sanitized form
        const sanitized = sanitizeBranchName(wt.branch)
        if (wt.branch !== sanitized) {
          names.add(wt.branch)
        }
      }
      // Also include the main repo's branch if it differs
      if (wt.isMain) {
        const repoName = sanitizeFolderName(repoRoot.split('/').pop() ?? 'main')
        if (wt.branch !== repoName) {
          names.add(wt.branch)
        }
      }
    }
  } catch {
    // git worktree list failed — fall back to directory names only
  }

  return Array.from(names)
}

/**
 * List worktree names only, one per line. Fast path that skips Docker/Traefik checks.
 * Includes both sanitized directory names and original git branch names.
 */
export async function list(): Promise<void> {
  try {
    const repoRoot = detectWorktree().repoRoot
    const names = await getWorktreeNamesWithOriginals(repoRoot)
    for (const name of names) {
      console.log(name)
    }
  } catch {
    // Not in a git repo — output nothing
  }
}

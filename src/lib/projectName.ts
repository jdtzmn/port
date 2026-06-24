import { basename } from 'path'
import { sanitizeBranchName, sanitizeFolderName } from './sanitize.ts'

/**
 * Generate a unique docker-compose project name from repo root and worktree name.
 * This ensures containers from different repos with same-named worktrees don't conflict.
 *
 * @param repoRoot - Absolute path to the repo root
 * @param worktreeName - The worktree/branch name
 * @returns A unique project name like "my-repo-feature-branch"
 */
export function buildProjectName(repoRoot: string, worktreeName: string): string {
  const repoName = sanitizeFolderName(basename(repoRoot))
  const sanitizedWorktreeName = sanitizeBranchName(worktreeName)
  // If worktree name is already the repo name (main repo case), just use it
  if (repoName === sanitizedWorktreeName) {
    return repoName
  }
  return `${repoName}-${sanitizedWorktreeName}`
}

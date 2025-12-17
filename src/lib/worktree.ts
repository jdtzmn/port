import { basename, resolve, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { WorktreeInfo } from '../types.ts'
import { sanitizeBranchName, sanitizeFolderName } from './sanitize.ts'
import { PORT_DIR, TREES_DIR } from './config.ts'

/**
 * Error thrown when worktree detection fails
 */
export class WorktreeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorktreeError'
  }
}

/**
 * Find the git repository root by looking for .git directory/file
 * Walks up the directory tree until it finds .git or hits the root
 *
 * @param startPath - The directory to start searching from
 * @returns The absolute path to the repo root, or null if not in a git repo
 */
export function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath)

  while (current !== '/') {
    const gitPath = `${current}/.git`

    if (existsSync(gitPath)) {
      return current
    }

    current = dirname(current)
  }

  return null
}

/**
 * Check if a .git path is a worktree (file pointing to main repo) or the main repo (.git directory)
 *
 * @param gitPath - Path to .git file or directory
 * @returns true if this is a worktree, false if main repo
 */
function isWorktreeGitFile(gitPath: string): boolean {
  try {
    // In a worktree, .git is a file containing "gitdir: /path/to/main/.git/worktrees/name"
    // In main repo, .git is a directory
    // We can check by trying to read it as a file
    const content = readFileSync(gitPath, 'utf-8')
    return content.startsWith('gitdir:')
  } catch {
    // If we can't read it as a file, it's a directory (main repo)
    return false
  }
}

/**
 * Get the main repository root from a worktree
 * Worktrees have a .git file that points to the main repo
 *
 * @param worktreePath - Path to the worktree
 * @returns The absolute path to the main repo root
 */
function getMainRepoFromWorktree(worktreePath: string): string {
  const gitFilePath = `${worktreePath}/.git`
  const content = readFileSync(gitFilePath, 'utf-8')

  // Format: "gitdir: /path/to/main/.git/worktrees/name"
  const match = content.match(/^gitdir:\s*(.+)$/m)
  if (!match?.[1]) {
    throw new WorktreeError(`Invalid .git file format in ${worktreePath}`)
  }

  const gitDir = match[1].trim()

  // The gitdir points to .git/worktrees/<name>, we need to go up to .git, then up to repo root
  // e.g., /path/to/main/.git/worktrees/feature-1 -> /path/to/main
  const mainGitDir = resolve(gitDir, '..', '..') // Go from .git/worktrees/name to .git
  const mainRepoRoot = dirname(mainGitDir) // Go from .git to repo root

  return mainRepoRoot
}

/**
 * Check if a path is inside the .port/trees directory
 *
 * @param path - The path to check
 * @param repoRoot - The main repo root
 * @returns The worktree name if inside trees dir, null otherwise
 */
function getWorktreeNameFromPath(path: string, repoRoot: string): string | null {
  const treesDir = resolve(repoRoot, PORT_DIR, TREES_DIR)
  const resolvedPath = resolve(path)

  if (!resolvedPath.startsWith(treesDir + '/')) {
    return null
  }

  // Extract the worktree name from the path
  // e.g., /repo/.port/trees/feature-1/src/foo -> feature-1
  const relativePath = resolvedPath.slice(treesDir.length + 1)
  const worktreeName = relativePath.split('/')[0]

  return worktreeName || null
}

/**
 * Detect worktree information from the current directory
 *
 * @param cwd - The current working directory (defaults to process.cwd())
 * @returns WorktreeInfo with repo root, worktree path, and name
 * @throws WorktreeError if not in a git repository
 */
export function detectWorktree(cwd: string = process.cwd()): WorktreeInfo {
  const gitRoot = findGitRoot(cwd)

  if (!gitRoot) {
    throw new WorktreeError('Not in a git repository')
  }

  const gitPath = `${gitRoot}/.git`
  const isWorktree = isWorktreeGitFile(gitPath)

  if (isWorktree) {
    // We're inside a worktree
    const mainRepoRoot = getMainRepoFromWorktree(gitRoot)
    const worktreeName = getWorktreeNameFromPath(gitRoot, mainRepoRoot)

    if (worktreeName) {
      // We're in a .port/trees/<name> worktree
      return {
        repoRoot: mainRepoRoot,
        worktreePath: gitRoot,
        name: worktreeName,
        isMainRepo: false,
      }
    } else {
      // We're in some other worktree (not managed by port)
      // Use the folder name as the name
      return {
        repoRoot: mainRepoRoot,
        worktreePath: gitRoot,
        name: sanitizeFolderName(basename(gitRoot)),
        isMainRepo: false,
      }
    }
  } else {
    // We're in the main repo
    return {
      repoRoot: gitRoot,
      worktreePath: gitRoot,
      name: sanitizeFolderName(basename(gitRoot)),
      isMainRepo: true,
    }
  }
}

/**
 * Get the worktree path for a given branch name
 *
 * @param repoRoot - The main repo root
 * @param branch - The branch name (will be sanitized)
 * @returns The absolute path where the worktree should be
 */
export function getWorktreePath(repoRoot: string, branch: string): string {
  const sanitized = sanitizeBranchName(branch)
  return resolve(repoRoot, PORT_DIR, TREES_DIR, sanitized)
}

/**
 * Check if a worktree exists for a given branch
 *
 * @param repoRoot - The main repo root
 * @param branch - The branch name (will be sanitized)
 * @returns true if the worktree directory exists
 */
export function worktreeExists(repoRoot: string, branch: string): boolean {
  const worktreePath = getWorktreePath(repoRoot, branch)
  return existsSync(worktreePath)
}

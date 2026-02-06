import simpleGit, { type SimpleGit } from 'simple-git'
import { existsSync } from 'fs'
import { getWorktreePath } from './worktree.ts'
import { sanitizeBranchName } from './sanitize.ts'

/**
 * Error thrown when git operations fail
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

/**
 * Get a simple-git instance for a repository
 */
export function getGit(repoPath: string): SimpleGit {
  return simpleGit(repoPath)
}

/**
 * Check if a branch exists in the repository
 *
 * @param repoRoot - The repository root path
 * @param branch - The branch name to check
 * @returns true if the branch exists
 */
export async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  const git = getGit(repoRoot)

  try {
    const branches = await git.branchLocal()
    return branches.all.includes(branch)
  } catch (error) {
    throw new GitError(`Failed to list branches: ${error}`)
  }
}

/**
 * List archived local branches created by port remove
 *
 * @param repoRoot - The repository root path
 * @returns Local branch names under archive/
 */
export async function listArchivedBranches(repoRoot: string): Promise<string[]> {
  const git = getGit(repoRoot)

  try {
    const branches = await git.branchLocal()
    return branches.all.filter(branch => branch.startsWith('archive/')).sort()
  } catch (error) {
    throw new GitError(`Failed to list archived branches: ${error}`)
  }
}

/**
 * Delete a local branch
 *
 * @param repoRoot - The repository root path
 * @param branch - The branch to delete
 * @param force - Use force delete (-D) when true
 */
export async function deleteLocalBranch(
  repoRoot: string,
  branch: string,
  force: boolean = false
): Promise<void> {
  const git = getGit(repoRoot)

  try {
    await git.raw(['branch', force ? '-D' : '-d', branch])
  } catch (error) {
    throw new GitError(`Failed to delete branch '${branch}': ${error}`)
  }
}

/**
 * Check if a remote branch exists
 *
 * @param repoRoot - The repository root path
 * @param branch - The branch name to check
 * @param remote - The remote name (default: 'origin')
 * @returns true if the remote branch exists
 */
export async function remoteBranchExists(
  repoRoot: string,
  branch: string,
  remote: string = 'origin'
): Promise<boolean> {
  const git = getGit(repoRoot)

  try {
    const refs = await git.listRemote(['--heads', remote, branch])
    return refs.trim().length > 0
  } catch {
    // Remote might not exist or be unreachable
    return false
  }
}

/**
 * Create a new branch from the current HEAD
 *
 * @param repoRoot - The repository root path
 * @param branch - The branch name to create
 */
export async function createBranch(repoRoot: string, branch: string): Promise<void> {
  const git = getGit(repoRoot)

  try {
    await git.checkoutLocalBranch(branch)
    // Switch back to previous branch
    await git.checkout('-')
  } catch (error) {
    throw new GitError(`Failed to create branch '${branch}': ${error}`)
  }
}

/**
 * Create a worktree for a branch
 *
 * If the branch doesn't exist locally:
 * - Check if it exists on remote, if so track it
 * - Otherwise create a new branch from current HEAD
 *
 * @param repoRoot - The repository root path
 * @param branch - The branch name
 * @returns The path to the created worktree
 */
export async function createWorktree(repoRoot: string, branch: string): Promise<string> {
  const git = getGit(repoRoot)
  const worktreePath = getWorktreePath(repoRoot, branch)

  if (existsSync(worktreePath)) {
    throw new GitError(`Worktree already exists at ${worktreePath}`)
  }

  try {
    const localExists = await branchExists(repoRoot, branch)

    if (localExists) {
      // Branch exists locally, create worktree for it
      await git.raw(['worktree', 'add', worktreePath, branch])
    } else {
      // Check if branch exists on remote
      const remoteExists = await remoteBranchExists(repoRoot, branch)

      if (remoteExists) {
        // Track the remote branch
        await git.raw([
          'worktree',
          'add',
          '--track',
          '-b',
          branch,
          worktreePath,
          `origin/${branch}`,
        ])
      } else {
        // Create new branch from HEAD
        await git.raw(['worktree', 'add', '-b', branch, worktreePath])
      }
    }

    return worktreePath
  } catch (error) {
    throw new GitError(`Failed to create worktree for '${branch}': ${error}`)
  }
}

/**
 * Remove a worktree
 *
 * @param repoRoot - The repository root path
 * @param branch - The branch name
 * @param force - Force removal even if there are uncommitted changes
 */
export async function removeWorktree(
  repoRoot: string,
  branch: string,
  force: boolean = false
): Promise<void> {
  const worktreePath = getWorktreePath(repoRoot, branch)

  if (!existsSync(worktreePath)) {
    throw new GitError(`Worktree does not exist: ${worktreePath}`)
  }

  return removeWorktreeAtPath(repoRoot, worktreePath, force)
}

/**
 * Remove a worktree by absolute path
 *
 * @param repoRoot - The repository root path
 * @param worktreePath - Absolute path to the worktree
 * @param force - Force removal even if there are uncommitted changes
 */
export async function removeWorktreeAtPath(
  repoRoot: string,
  worktreePath: string,
  force: boolean = false
): Promise<void> {
  const git = getGit(repoRoot)

  try {
    const args = ['worktree', 'remove']
    if (force) {
      args.push('--force')
    }
    args.push(worktreePath)

    await git.raw(args)
  } catch (error) {
    throw new GitError(`Failed to remove worktree at '${worktreePath}': ${error}`)
  }
}

export interface WorktreeEntry {
  path: string
  branch: string
  isMain: boolean
}

/**
 * List all worktrees in the repository
 *
 * @param repoRoot - The repository root path
 * @returns Array of worktree info objects
 */
export async function listWorktrees(repoRoot: string): Promise<WorktreeEntry[]> {
  const git = getGit(repoRoot)

  try {
    const output = await git.raw(['worktree', 'list', '--porcelain'])
    const worktrees: WorktreeEntry[] = []

    let currentWorktree: { path?: string; branch?: string } = {}

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        currentWorktree.path = line.slice('worktree '.length)
      } else if (line.startsWith('branch refs/heads/')) {
        currentWorktree.branch = line.slice('branch refs/heads/'.length)
      } else if (line === '') {
        if (currentWorktree.path && currentWorktree.branch) {
          worktrees.push({
            path: currentWorktree.path,
            branch: currentWorktree.branch,
            isMain: currentWorktree.path === repoRoot,
          })
        }
        currentWorktree = {}
      }
    }

    return worktrees
  } catch (error) {
    throw new GitError(`Failed to list worktrees: ${error}`)
  }
}

/**
 * Find a registered worktree by branch name
 *
 * @param repoRoot - The repository root path
 * @param branch - The branch name
 * @returns The matching worktree entry, or null if not found
 */
export async function findWorktreeByBranch(
  repoRoot: string,
  branch: string
): Promise<WorktreeEntry | null> {
  const worktrees = await listWorktrees(repoRoot)
  const sanitized = sanitizeBranchName(branch)
  return (
    worktrees.find(
      worktree => worktree.branch === branch || sanitizeBranchName(worktree.branch) === sanitized
    ) ?? null
  )
}

/**
 * Get the current branch name
 *
 * @param repoPath - The repository or worktree path
 * @returns The current branch name
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const git = getGit(repoPath)

  try {
    const branch = await git.revparse(['--abbrev-ref', 'HEAD'])
    return branch.trim()
  } catch (error) {
    throw new GitError(`Failed to get current branch: ${error}`)
  }
}

/**
 * Prune worktree references for deleted worktrees
 *
 * @param repoRoot - The repository root path
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  const git = getGit(repoRoot)

  try {
    await git.raw(['worktree', 'prune'])
  } catch (error) {
    throw new GitError(`Failed to prune worktrees: ${error}`)
  }
}

/**
 * Soft-delete a local branch by renaming it to archive/<name>-<timestamp>.
 *
 * @param repoRoot - The repository root path
 * @param branch - Branch name to archive
 * @returns Archived branch name, or null when source branch does not exist
 */
export async function archiveBranch(repoRoot: string, branch: string): Promise<string | null> {
  const git = getGit(repoRoot)

  if (!(await branchExists(repoRoot, branch))) {
    return null
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const sanitized = sanitizeBranchName(branch)
  const baseArchivedName = `archive/${sanitized}-${timestamp}`

  let archivedName = baseArchivedName
  let suffix = 1

  while (await branchExists(repoRoot, archivedName)) {
    archivedName = `${baseArchivedName}-${suffix}`
    suffix += 1
  }

  try {
    await git.raw(['branch', '-m', branch, archivedName])
    return archivedName
  } catch (error) {
    throw new GitError(`Failed to archive branch '${branch}': ${error}`)
  }
}

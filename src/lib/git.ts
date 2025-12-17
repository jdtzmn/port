import simpleGit, { type SimpleGit } from 'simple-git'
import { existsSync } from 'fs'
import { getWorktreePath } from './worktree.ts'

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
  const git = getGit(repoRoot)
  const worktreePath = getWorktreePath(repoRoot, branch)

  if (!existsSync(worktreePath)) {
    throw new GitError(`Worktree does not exist: ${worktreePath}`)
  }

  try {
    const args = ['worktree', 'remove']
    if (force) {
      args.push('--force')
    }
    args.push(worktreePath)

    await git.raw(args)
  } catch (error) {
    throw new GitError(`Failed to remove worktree '${branch}': ${error}`)
  }
}

/**
 * List all worktrees in the repository
 *
 * @param repoRoot - The repository root path
 * @returns Array of worktree info objects
 */
export async function listWorktrees(
  repoRoot: string
): Promise<Array<{ path: string; branch: string; isMain: boolean }>> {
  const git = getGit(repoRoot)

  try {
    const output = await git.raw(['worktree', 'list', '--porcelain'])
    const worktrees: Array<{ path: string; branch: string; isMain: boolean }> = []

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

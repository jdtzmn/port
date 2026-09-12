import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

export interface ListWorktreeEntry {
  path: string
  branch: string
  isMain: boolean
}

/** Resolve the main repository root without loading the general worktree stack. */
export function detectWorktree(cwd: string = process.cwd()): { repoRoot: string } {
  let current = resolve(cwd)

  while (true) {
    const gitPath = join(current, '.git')
    if (existsSync(gitPath)) {
      try {
        const content = readFileSync(gitPath, 'utf-8')
        const gitDir = content.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
        if (gitDir) {
          return { repoRoot: dirname(resolve(gitDir, '..', '..')) }
        }
      } catch {
        // A .git directory denotes the main repository.
      }

      return { repoRoot: current }
    }

    const parent = dirname(current)
    if (parent === current) {
      throw new Error('Not in a git repository')
    }
    current = parent
  }
}

export function getTreesDir(repoRoot: string): string {
  return join(repoRoot, '.port', 'trees')
}

/**
 * Read only the worktree metadata needed by `port list`, avoiding simple-git's
 * full command stack on this startup-sensitive path.
 */
export function parseListWorktrees(output: string, repoRoot: string): ListWorktreeEntry[] {
  const worktrees: ListWorktreeEntry[] = []
  let current: { path?: string; branch?: string } = {}

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length)
    } else if (line === '') {
      if (current.path && current.branch) {
        worktrees.push({
          path: current.path,
          branch: current.branch,
          isMain: current.path === repoRoot,
        })
      }
      current = {}
    }
  }

  return worktrees
}

/**
 * Read only the worktree metadata needed by `port list`, avoiding simple-git's
 * full command stack on this startup-sensitive path.
 */
export async function listWorktrees(repoRoot: string): Promise<ListWorktreeEntry[]> {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  })
  return parseListWorktrees(output, repoRoot)
}

import { detectWorktree } from '../lib/worktree.ts'
import * as output from '../lib/output.ts'

/**
 * Exit a port worktree and return to the repository root.
 *
 * Behavior:
 * - If inside a port sub-shell (PORT_WORKTREE is set), exits the sub-shell via process.exit(0).
 *   The parent `port enter` process will catch the exit and return to the original shell.
 * - If in a worktree but NOT in a sub-shell, prints `cd <repoRoot>` so the user can
 *   copy-paste it or use `eval $(port exit)`.
 * - If already at the repository root, informs the user.
 */
export async function exit(): Promise<void> {
  const inSubShell = !!process.env.PORT_WORKTREE

  let repoRoot: string
  let isMainRepo: boolean
  try {
    const info = detectWorktree()
    repoRoot = info.repoRoot
    isMainRepo = info.isMainRepo
  } catch {
    output.error('Not in a git repository')
    process.exit(1)
  }

  // If in a port sub-shell, exit it
  if (inSubShell) {
    output.dim(`Leaving worktree: ${process.env.PORT_WORKTREE}`)
    process.exit(0)
  }

  // Not in a sub-shell — check if we're in a worktree
  if (isMainRepo) {
    output.info('Already at the repository root')
    return
  }

  // In a worktree but not a sub-shell — print cd command for the user
  // This output can be used with: eval $(port exit)
  console.log(`cd ${repoRoot}`)
}

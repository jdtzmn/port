import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'

function getWorktreeGroup(activeWorktreeName: string, worktree: WorktreeStatus): number {
  if (worktree.name === activeWorktreeName) return 0
  if (worktree.running) return 1
  return 2
}

export function orderWorktreesForDashboard(
  worktrees: WorktreeStatus[],
  activeWorktreeName: string
): WorktreeStatus[] {
  return worktrees
    .map((worktree, index) => ({ ...worktree, __order: index }))
    .sort((a, b) => {
      const groupDiff =
        getWorktreeGroup(activeWorktreeName, a) - getWorktreeGroup(activeWorktreeName, b)
      if (groupDiff !== 0) return groupDiff
      return a.__order - b.__order
    })
    .map(({ __order, ...worktree }) => worktree)
}

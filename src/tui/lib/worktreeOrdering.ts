import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'

function getWorktreeGroup(activeWorktreeName: string, worktree: WorktreeStatus): number {
  if (worktree.name === activeWorktreeName) return 0
  if (worktree.running) return 1
  return 2
}

function parseTimestamp(value?: string): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function compareDescendingTimestamps(a?: string, b?: string): number {
  const aTime = parseTimestamp(a)
  const bTime = parseTimestamp(b)

  if (aTime !== null && bTime !== null) {
    return bTime - aTime
  }

  if (aTime !== null) return -1
  if (bTime !== null) return 1
  return 0
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

      const createdDiff = compareDescendingTimestamps(a.createdAt, b.createdAt)
      if (createdDiff !== 0) return createdDiff

      return a.name.localeCompare(b.name) || a.__order - b.__order
    })
    .map(({ __order, ...worktree }) => worktree)
}

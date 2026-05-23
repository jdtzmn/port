import { describe, expect, test } from 'bun:test'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import { orderWorktreesForDashboard } from './worktreeOrdering.ts'

const worktrees: WorktreeStatus[] = [
  {
    name: 'alpha',
    path: '/repo/.port/trees/alpha',
    services: [],
    running: false,
  },
  {
    name: 'beta',
    path: '/repo/.port/trees/beta',
    services: [],
    running: true,
  },
  {
    name: 'current',
    path: '/repo/.port/trees/current',
    services: [],
    running: false,
  },
  {
    name: 'gamma',
    path: '/repo/.port/trees/gamma',
    services: [],
    running: true,
  },
]

describe('orderWorktreesForDashboard', () => {
  test('puts the selected worktree first, then running worktrees, then idle worktrees', () => {
    expect(orderWorktreesForDashboard(worktrees, 'current').map(worktree => worktree.name)).toEqual([
      'current',
      'beta',
      'gamma',
      'alpha',
    ])
  })
})

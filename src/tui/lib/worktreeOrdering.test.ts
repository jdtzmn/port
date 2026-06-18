import { describe, expect, test } from 'vitest'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import { orderWorktreesForDashboard } from './worktreeOrdering.ts'

type OrderedWorktree = WorktreeStatus & {
  createdAt?: string
}

describe('orderWorktreesForDashboard', () => {
  test('puts the selected worktree first, then running worktrees, then idle worktrees', () => {
    const worktrees: OrderedWorktree[] = [
      {
        name: 'alpha',
        path: '/repo/.port/trees/alpha',
        services: [],
        running: false,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      {
        name: 'beta',
        path: '/repo/.port/trees/beta',
        services: [],
        running: true,
        createdAt: '2026-05-02T00:00:00.000Z',
      },
      {
        name: 'current',
        path: '/repo/.port/trees/current',
        services: [],
        running: false,
        createdAt: '2026-05-03T00:00:00.000Z',
      },
      {
        name: 'gamma',
        path: '/repo/.port/trees/gamma',
        services: [],
        running: true,
        createdAt: '2026-05-04T00:00:00.000Z',
      },
    ]

    expect(orderWorktreesForDashboard(worktrees, 'current').map(worktree => worktree.name)).toEqual([
      'current',
      'gamma',
      'beta',
      'alpha',
    ])
  })

  test('sorts worktrees by creation time within the same bucket', () => {
    const worktrees: OrderedWorktree[] = [
      {
        name: 'idle-old',
        path: '/repo/.port/trees/idle-old',
        services: [],
        running: false,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      {
        name: 'running-stale',
        path: '/repo/.port/trees/running-stale',
        services: [],
        running: true,
        createdAt: '2026-05-02T00:00:00.000Z',
      },
      {
        name: 'running-newer',
        path: '/repo/.port/trees/running-newer',
        services: [],
        running: true,
        createdAt: '2026-05-03T00:00:00.000Z',
      },
      {
        name: 'idle-newer',
        path: '/repo/.port/trees/idle-newer',
        services: [],
        running: false,
        createdAt: '2026-05-05T00:00:00.000Z',
      },
    ]

    expect(orderWorktreesForDashboard(worktrees, 'missing').map(worktree => worktree.name)).toEqual([
      'running-newer',
      'running-stale',
      'idle-newer',
      'idle-old',
    ])
  })

  test('uses creation time then name as fallback for untouched worktrees', () => {
    const worktrees: OrderedWorktree[] = [
      {
        name: 'zeta',
        path: '/repo/.port/trees/zeta',
        services: [],
        running: false,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      {
        name: 'alpha',
        path: '/repo/.port/trees/alpha',
        services: [],
        running: false,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      {
        name: 'beta',
        path: '/repo/.port/trees/beta',
        services: [],
        running: false,
        createdAt: '2026-05-02T00:00:00.000Z',
      },
    ]

    expect(orderWorktreesForDashboard(worktrees, 'missing').map(worktree => worktree.name)).toEqual([
      'beta',
      'alpha',
      'zeta',
    ])
  })
})

import { describe, expect, test } from 'vitest'
import { parseListWorktrees } from './listWorktrees.ts'

describe('parseListWorktrees', () => {
  test('parses branch worktrees and skips detached entries', () => {
    const output = `worktree /repo
HEAD abc123
branch refs/heads/main

worktree /repo/.port/trees/feature
HEAD def456
branch refs/heads/feature/test

worktree /repo/.port/trees/detached
HEAD fedcba
detached

`

    expect(parseListWorktrees(output, '/repo')).toEqual([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/repo/.port/trees/feature', branch: 'feature/test', isMain: false },
    ])
  })
})

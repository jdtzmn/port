import { describe, expect, test } from 'bun:test'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import {
  findAdjacentMatchIndex,
  findInitialFilteredSelection,
  findMatchingIndices,
  findSubstringMatchRanges,
} from '../lib/filtering.ts'

const worktrees: WorktreeStatus[] = [
  { name: 'myapp', path: '/repo', services: [], running: false },
  { name: 'feature-auth', path: '/repo/.port/trees/feature-auth', services: [], running: false },
  { name: 'bug-auth-ui', path: '/repo/.port/trees/bug-auth-ui', services: [], running: false },
  { name: 'chore-docs', path: '/repo/.port/trees/chore-docs', services: [], running: false },
]

describe('findSubstringMatchRanges', () => {
  test('returns all case-insensitive matches', () => {
    expect(findSubstringMatchRanges('bug-auth-auth', 'AUTH')).toEqual([
      { start: 4, end: 8 },
      { start: 9, end: 13 },
    ])
  })

  test('returns empty ranges for empty query', () => {
    expect(findSubstringMatchRanges('feature-auth', '')).toEqual([])
  })

  test('returns empty ranges when there are no matches', () => {
    expect(findSubstringMatchRanges('feature-auth', 'xyz')).toEqual([])
  })

  test('returns non-overlapping matches in sequence', () => {
    expect(findSubstringMatchRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })
})

describe('findMatchingIndices', () => {
  test('returns indices for matching worktree names', () => {
    expect(findMatchingIndices(worktrees, 'auth')).toEqual([1, 2])
  })

  test('returns empty array for empty query', () => {
    expect(findMatchingIndices(worktrees, '')).toEqual([])
  })

  test('returns empty array when no names match', () => {
    expect(findMatchingIndices(worktrees, 'nope')).toEqual([])
  })
})

describe('findAdjacentMatchIndex', () => {
  test('moves to the next matching index', () => {
    expect(findAdjacentMatchIndex(1, 1, [1, 3, 7])).toBe(3)
  })

  test('moves to the previous matching index', () => {
    expect(findAdjacentMatchIndex(7, -1, [1, 3, 7])).toBe(3)
  })

  test('wraps to first match when moving past the last match', () => {
    expect(findAdjacentMatchIndex(7, 1, [1, 3, 7])).toBe(1)
  })

  test('wraps to last match when moving before the first match', () => {
    expect(findAdjacentMatchIndex(1, -1, [1, 3, 7])).toBe(7)
  })

  test('stays put when no matches exist', () => {
    expect(findAdjacentMatchIndex(4, 1, [])).toBe(4)
  })
})

describe('findInitialFilteredSelection', () => {
  test('keeps selection if current index already matches', () => {
    expect(findInitialFilteredSelection(3, [1, 3, 7])).toBe(3)
  })

  test('selects first later match when current index does not match', () => {
    expect(findInitialFilteredSelection(2, [1, 3, 7])).toBe(3)
  })

  test('falls back to first match when all matches are before current index', () => {
    expect(findInitialFilteredSelection(8, [1, 3, 7])).toBe(1)
  })

  test('keeps selection when there are no matches', () => {
    expect(findInitialFilteredSelection(5, [])).toBe(5)
  })
})

import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'

export interface MatchRange {
  start: number
  end: number
}

export function findSubstringMatchRanges(text: string, query: string): MatchRange[] {
  if (query.length === 0) return []

  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const ranges: MatchRange[] = []

  let fromIndex = 0
  while (fromIndex < haystack.length) {
    const matchIndex = haystack.indexOf(needle, fromIndex)
    if (matchIndex === -1) break

    ranges.push({ start: matchIndex, end: matchIndex + needle.length })
    fromIndex = matchIndex + needle.length
  }

  return ranges
}

export function findMatchingIndices(worktrees: WorktreeStatus[], query: string): number[] {
  if (query.length === 0) return []

  return worktrees
    .map((worktree, index) => ({ worktree, index }))
    .filter(({ worktree }) => findSubstringMatchRanges(worktree.name, query).length > 0)
    .map(({ index }) => index)
}

export function findAdjacentMatchIndex(
  currentIndex: number,
  direction: 1 | -1,
  matchingIndices: number[]
): number {
  if (matchingIndices.length === 0) return currentIndex

  if (direction > 0) {
    for (const index of matchingIndices) {
      if (index > currentIndex) return index
    }
    return currentIndex
  }

  for (let i = matchingIndices.length - 1; i >= 0; i--) {
    if (matchingIndices[i]! < currentIndex) return matchingIndices[i]!
  }

  return currentIndex
}

export function findInitialFilteredSelection(
  currentIndex: number,
  matchingIndices: number[]
): number {
  if (matchingIndices.length === 0) return currentIndex
  if (matchingIndices.includes(currentIndex)) return currentIndex

  for (const index of matchingIndices) {
    if (index > currentIndex) return index
  }

  return matchingIndices[0]!
}

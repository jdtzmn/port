import { useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  findAdjacentMatchIndex,
  findInitialFilteredSelection,
  findMatchingIndicesByText,
} from '../lib/filtering.ts'

export type FilterMode = 'normal' | 'query' | 'filtered-nav'

interface FilterNavigationOptions<T> {
  items: T[]
  setSelectedIndex: Dispatch<SetStateAction<number>>
  getSearchText: (item: T) => string
}

interface FilterNavigationHandleKeyOptions {
  eventName: string
  keySequence?: string
}

interface FilterNavigationResult {
  mode: FilterMode
  appliedQuery: string
  draftQuery: string
  highlightQuery: string
  highlightMatches: number[]
  handleKey: (opts: FilterNavigationHandleKeyOptions) => boolean
  clearFilter: () => void
}

export function useFilterNavigation<T>({
  items,
  setSelectedIndex,
  getSearchText,
}: FilterNavigationOptions<T>): FilterNavigationResult {
  const [mode, setMode] = useState<FilterMode>('normal')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [draftQuery, setDraftQuery] = useState('')

  const modeRef = useRef<FilterMode>(mode)
  const appliedQueryRef = useRef(appliedQuery)
  const draftQueryRef = useRef(draftQuery)

  modeRef.current = mode
  appliedQueryRef.current = appliedQuery
  draftQueryRef.current = draftQuery

  const updateMode = (nextMode: FilterMode) => {
    modeRef.current = nextMode
    setMode(nextMode)
  }

  const updateAppliedQuery = (nextQuery: string) => {
    appliedQueryRef.current = nextQuery
    setAppliedQuery(nextQuery)
  }

  const updateDraftQuery = (nextQuery: string) => {
    draftQueryRef.current = nextQuery
    setDraftQuery(nextQuery)
  }

  const highlightQuery = mode === 'query' ? draftQuery : mode === 'filtered-nav' ? appliedQuery : ''
  const highlightMatches = useMemo(
    () => findMatchingIndicesByText(items, getSearchText, highlightQuery),
    [items, getSearchText, highlightQuery]
  )

  const clearFilter = () => {
    updateMode('normal')
    updateAppliedQuery('')
    updateDraftQuery('')
  }

  const handleKey = ({ eventName, keySequence }: FilterNavigationHandleKeyOptions): boolean => {
    const currentMode = modeRef.current
    const currentAppliedQuery = appliedQueryRef.current
    const currentDraftQuery = draftQueryRef.current

    if (currentMode === 'query') {
      switch (eventName) {
        case 'escape':
        case 'esc':
          updateDraftQuery(currentAppliedQuery)
          updateMode(currentAppliedQuery.length > 0 ? 'filtered-nav' : 'normal')
          return true
        case 'return': {
          if (currentDraftQuery.length === 0) {
            clearFilter()
            return true
          }

          const matchingIndices = findMatchingIndicesByText(items, getSearchText, currentDraftQuery)
          updateAppliedQuery(currentDraftQuery)
          updateMode('filtered-nav')
          setSelectedIndex(index => findInitialFilteredSelection(index, matchingIndices))
          return true
        }
        case 'backspace':
        case 'delete':
          updateDraftQuery(currentDraftQuery.slice(0, -1))
          return true
        default:
          if (eventName.length === 1) {
            updateDraftQuery(`${currentDraftQuery}${eventName}`)
            return true
          }

          if (typeof keySequence === 'string' && keySequence.length === 1) {
            updateDraftQuery(`${currentDraftQuery}${keySequence}`)
            return true
          }
          return false
      }
    }

    if (
      eventName === 'slash' ||
      eventName === 'forwardslash' ||
      eventName === '/' ||
      keySequence === '/'
    ) {
      updateDraftQuery(currentMode === 'filtered-nav' ? '' : currentAppliedQuery)
      updateMode('query')
      return true
    }

    if (currentMode === 'filtered-nav') {
      const filteredMatches = findMatchingIndicesByText(items, getSearchText, currentAppliedQuery)
      switch (eventName) {
        case 'escape':
        case 'esc':
          clearFilter()
          return true
        case 'j':
        case 'down':
          setSelectedIndex(index => findAdjacentMatchIndex(index, 1, filteredMatches))
          return true
        case 'k':
        case 'up':
          setSelectedIndex(index => findAdjacentMatchIndex(index, -1, filteredMatches))
          return true
      }
    }

    return false
  }

  return {
    mode,
    appliedQuery,
    draftQuery,
    highlightQuery,
    highlightMatches,
    handleKey,
    clearFilter,
  }
}

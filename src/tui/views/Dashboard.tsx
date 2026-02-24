import { useEffect, useRef, useState } from 'react'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus, WorktreeServiceStatus } from '../../lib/worktreeStatus.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { KeyHints } from '../components/KeyHints.tsx'
import { Confirm } from '../components/Confirm.tsx'

interface Actions {
  upWorktree: (worktreePath: string, worktreeName: string) => Promise<ActionResult>
  downWorktree: (worktreePath: string, worktreeName: string) => Promise<ActionResult>
  archiveWorktree: (worktreePath: string, worktreeName: string) => Promise<ActionResult>
}

interface DashboardProps {
  repoRoot: string
  repoName: string
  worktrees: WorktreeStatus[]
  hostServices: HostService[]
  traefikRunning: boolean
  config: PortConfig
  onSelectWorktree: (name: string) => void
  onOpenWorktree: (name: string) => void
  activeWorktreeName: string
  initialSelectedName: string | null
  actions: Actions
  refresh: () => void
  loading: boolean
  statusMessage: { text: string; type: 'success' | 'error' } | null
  showStatus: (text: string, type: 'success' | 'error') => void
}

type PendingAction = 'archive' | null
type JumpMode = 'normal' | 'query' | 'filtered-nav'

interface MatchRange {
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

function findMatchingIndices(worktrees: WorktreeStatus[], query: string): number[] {
  if (query.length === 0) return []

  return worktrees
    .map((worktree, index) => ({ worktree, index }))
    .filter(({ worktree }) => findSubstringMatchRanges(worktree.name, query).length > 0)
    .map(({ index }) => index)
}

function findAdjacentMatchIndex(
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

function findInitialFilteredSelection(currentIndex: number, matchingIndices: number[]): number {
  if (matchingIndices.length === 0) return currentIndex
  if (matchingIndices.includes(currentIndex)) return currentIndex

  for (const index of matchingIndices) {
    if (index > currentIndex) return index
  }

  return matchingIndices[0]!
}

interface NameSegment {
  text: string
  matched: boolean
}

function buildNameSegments(name: string, query: string): NameSegment[] {
  const ranges = findSubstringMatchRanges(name, query)

  if (ranges.length === 0) {
    return [{ text: name, matched: false }]
  }

  const segments: NameSegment[] = []
  let cursor = 0

  for (const range of ranges) {
    if (cursor < range.start) {
      segments.push({ text: name.slice(cursor, range.start), matched: false })
    }

    segments.push({ text: name.slice(range.start, range.end), matched: true })

    cursor = range.end
  }

  if (cursor < name.length) {
    segments.push({ text: name.slice(cursor), matched: false })
  }

  return segments
}

/**
 * Width of a single service chip: "name ●" = name.length + 2 chars.
 * Between chips, the parent row's gap={1} adds 1 char of spacing.
 */
function serviceChipWidth(name: string): number {
  return name.length + 2
}

/**
 * Determine how many services fit in `availableWidth` columns.
 * Returns the visible services and the count of hidden ones.
 * When truncating, reserves space for the "…+N more" indicator.
 */
export function fitServices(
  services: WorktreeServiceStatus[],
  availableWidth: number
): { visible: WorktreeServiceStatus[]; hiddenCount: number } {
  if (services.length === 0) return { visible: [], hiddenCount: 0 }

  // Check if all services fit
  const totalWidth = services.reduce(
    (sum, s, i) => sum + serviceChipWidth(s.name) + (i > 0 ? 1 : 0),
    0
  )
  if (totalWidth <= availableWidth) {
    return { visible: services, hiddenCount: 0 }
  }

  // Binary-style: greedily fit services, reserving room for the overflow tag
  const visible: WorktreeServiceStatus[] = []
  let used = 0

  for (let i = 0; i < services.length; i++) {
    const chipW = serviceChipWidth(services[i]!.name) + (visible.length > 0 ? 1 : 0)
    const remaining = services.length - i - 1
    // If this isn't the last service, we need to reserve space for "…+N more"
    // The overflow tag width: gap(1) + "…+" (2) + digits + " more" (5)
    const overflowTagWidth = remaining > 0 ? 1 + 2 + String(remaining).length + 5 : 0

    if (used + chipW + overflowTagWidth <= availableWidth) {
      visible.push(services[i]!)
      used += chipW
    } else {
      break
    }
  }

  const hiddenCount = services.length - visible.length
  return { visible, hiddenCount }
}

export function Dashboard({
  repoName,
  worktrees,
  traefikRunning,
  onSelectWorktree,
  onOpenWorktree,
  activeWorktreeName,
  initialSelectedName,
  actions,
  loading,
  statusMessage,
  showStatus,
}: DashboardProps) {
  const { width: terminalWidth } = useTerminalDimensions()
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (!initialSelectedName) return 0
    const idx = worktrees.findIndex(w => w.name === initialSelectedName)
    return idx >= 0 ? idx : 0
  })
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)
  const [jumpMode, setJumpMode] = useState<JumpMode>('normal')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const initialSelectionAppliedRef = useRef(false)

  useEffect(() => {
    if (initialSelectionAppliedRef.current) return

    if (!initialSelectedName) {
      initialSelectionAppliedRef.current = true
      return
    }

    if (worktrees.length === 0) {
      return
    }

    const idx = worktrees.findIndex(w => w.name === initialSelectedName)
    if (idx >= 0) {
      setSelectedIndex(idx)
    }

    initialSelectionAppliedRef.current = true
  }, [initialSelectedName, worktrees])

  const jumpModeRef = useRef<JumpMode>(jumpMode)
  const appliedQueryRef = useRef(appliedQuery)
  const draftQueryRef = useRef(draftQuery)

  jumpModeRef.current = jumpMode
  appliedQueryRef.current = appliedQuery
  draftQueryRef.current = draftQuery

  const updateJumpMode = (nextMode: JumpMode) => {
    jumpModeRef.current = nextMode
    setJumpMode(nextMode)
  }

  const updateAppliedQuery = (nextQuery: string) => {
    appliedQueryRef.current = nextQuery
    setAppliedQuery(nextQuery)
  }

  const updateDraftQuery = (nextQuery: string) => {
    draftQueryRef.current = nextQuery
    setDraftQuery(nextQuery)
  }

  const selectedWorktree = worktrees[selectedIndex]
  const isRootSelected = selectedIndex === 0
  const highlightQuery =
    jumpMode === 'query' ? draftQuery : jumpMode === 'filtered-nav' ? appliedQuery : ''
  const highlightMatches = findMatchingIndices(worktrees, highlightQuery)
  useKeyboard(event => {
    if (event.ctrl || event.meta || busy) return

    const keySequence = (event as { sequence?: string }).sequence
    const maxIndex = worktrees.length - 1
    const currentJumpMode = jumpModeRef.current
    const currentAppliedQuery = appliedQueryRef.current
    const currentDraftQuery = draftQueryRef.current

    // If we're in a confirm dialog, don't handle navigation
    if (pendingAction) return

    if (currentJumpMode === 'query') {
      switch (event.name) {
        case 'escape':
        case 'esc':
          updateDraftQuery(currentAppliedQuery)
          updateJumpMode(currentAppliedQuery.length > 0 ? 'filtered-nav' : 'normal')
          return
        case 'return':
          if (currentDraftQuery.length === 0) {
            updateAppliedQuery('')
            updateJumpMode('normal')
            return
          }

          {
            const matchingIndices = findMatchingIndices(worktrees, currentDraftQuery)
            updateAppliedQuery(currentDraftQuery)
            updateJumpMode('filtered-nav')
            setSelectedIndex(index => findInitialFilteredSelection(index, matchingIndices))
          }
          return
        case 'backspace':
        case 'delete':
          updateDraftQuery(currentDraftQuery.slice(0, -1))
          return
        default:
          if (event.name.length === 1) {
            updateDraftQuery(`${currentDraftQuery}${event.name}`)
            return
          }

          if (typeof keySequence === 'string' && keySequence.length === 1) {
            updateDraftQuery(`${currentDraftQuery}${keySequence}`)
            return
          }
          return
      }
    }

    if (
      event.name === 'slash' ||
      event.name === 'forwardslash' ||
      event.name === '/' ||
      keySequence === '/'
    ) {
      updateDraftQuery(currentJumpMode === 'filtered-nav' ? '' : currentAppliedQuery)
      updateJumpMode('query')
      return
    }

    if (currentJumpMode === 'filtered-nav') {
      const filteredMatches = findMatchingIndices(worktrees, currentAppliedQuery)
      switch (event.name) {
        case 'escape':
        case 'esc':
          updateJumpMode('normal')
          updateAppliedQuery('')
          updateDraftQuery('')
          return
        case 'j':
        case 'down':
          setSelectedIndex(index => findAdjacentMatchIndex(index, 1, filteredMatches))
          return
        case 'k':
        case 'up':
          setSelectedIndex(index => findAdjacentMatchIndex(index, -1, filteredMatches))
          return
      }
    }

    switch (event.name) {
      case 'j':
      case 'down':
        setSelectedIndex(i => Math.min(i + 1, maxIndex))
        break
      case 'k':
      case 'up':
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'return':
        if (selectedWorktree) {
          onSelectWorktree(selectedWorktree.name)
        }
        break
      case 'u':
        if (selectedWorktree) {
          setBusy(true)
          actions
            .upWorktree(selectedWorktree.path, selectedWorktree.name)
            .then(result => {
              showStatus(result.message, result.success ? 'success' : 'error')
            })
            .finally(() => setBusy(false))
        }
        break
      case 'd':
        if (selectedWorktree) {
          setBusy(true)
          actions
            .downWorktree(selectedWorktree.path, selectedWorktree.name)
            .then(result => {
              showStatus(result.message, result.success ? 'success' : 'error')
            })
            .finally(() => setBusy(false))
        }
        break
      case 'o':
        if (selectedWorktree) {
          onOpenWorktree(selectedWorktree.name)
        }
        break
      case 'a':
        if (selectedWorktree && !isRootSelected) {
          setPendingAction('archive')
        }
        break
    }
  })

  const handleConfirmArchive = () => {
    if (!selectedWorktree) return
    setPendingAction(null)
    setBusy(true)
    actions
      .archiveWorktree(selectedWorktree.path, selectedWorktree.name)
      .then(result => {
        showStatus(result.message, result.success ? 'success' : 'error')
        // Adjust selection if needed
        if (selectedIndex >= worktrees.length - 1) {
          setSelectedIndex(Math.max(0, worktrees.length - 2))
        }
      })
      .finally(() => setBusy(false))
  }

  const handleCancelAction = () => {
    setPendingAction(null)
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text>
          <b>port: {repoName}</b>
        </text>
        {loading && <text fg="#888888"> refreshing...</text>}
        {busy && <text fg="#FFFF00"> working...</text>}
      </box>

      <box height={1} />

      {/* Traefik status */}
      <box flexDirection="row" gap={1}>
        <text fg="#888888">Traefik:</text>
        <StatusIndicator running={traefikRunning} />
        <text>{traefikRunning ? 'running' : 'stopped'}</text>
      </box>

      <box height={1} />

      {/* Worktree list header */}
      <text fg="#888888">
        <b>Worktrees</b>
      </text>

      {/* Worktree rows */}
      {worktrees.length === 0 && !loading && <text fg="#888888">No worktrees found</text>}

      {worktrees.map((worktree, index) => {
        const isSelected = index === selectedIndex
        const isRoot = index === 0
        const isActive = worktree.name === activeWorktreeName
        const nameSegments = buildNameSegments(worktree.name, highlightQuery)
        const sortedServices = [...worktree.services].sort(
          (a, b) => Number(b.running) - Number(a.running)
        )

        // Calculate prefix width: "> " (2) + gap(1) + star? (1+1gap) + name + " (root)"? + gap(1)
        const prefixWidth = 2 + (isActive ? 2 : 0) + worktree.name.length + (isRoot ? 7 : 0) + 1
        const availableWidth = terminalWidth - prefixWidth
        const { visible, hiddenCount } = fitServices(sortedServices, availableWidth)

        return (
          <box key={worktree.name} flexDirection="row" gap={1}>
            <text>{isSelected ? '>' : ' '}</text>
            {isActive && <text fg="#FFFF00">★</text>}
            <box flexDirection="row" gap={0}>
              {nameSegments.map((segment, segmentIndex) => (
                <text
                  key={`${worktree.name}-segment-${segmentIndex}`}
                  fg={segment.matched ? '#00AAFF' : undefined}
                >
                  {isSelected ? <b>{segment.text}</b> : segment.text}
                </text>
              ))}
              {isRoot && <text>{isSelected ? <b> (root)</b> : ' (root)'}</text>}
            </box>
            {worktree.services.length === 0 && loading ? (
              <text fg="#555555">...</text>
            ) : (
              <>
                {visible.map(service => (
                  <box key={service.name} flexDirection="row" gap={0}>
                    <text fg="#888888">{service.name} </text>
                    <StatusIndicator running={service.running} />
                  </box>
                ))}
                {hiddenCount > 0 && <text fg="#555555">{`…+${hiddenCount} more`}</text>}
              </>
            )}
          </box>
        )
      })}

      {/* Spacer */}
      <box flexGrow={1} />

      {/* Status message */}
      {statusMessage && (
        <text fg={statusMessage.type === 'success' ? '#00FF00' : '#FF4444'}>
          {statusMessage.text}
        </text>
      )}

      {/* Jump prompt */}
      {jumpMode !== 'normal' && (
        <text
          fg={
            jumpMode === 'query'
              ? highlightQuery.length === 0
                ? '#888888'
                : highlightMatches.length > 0
                  ? '#00AAFF'
                  : '#FFAA00'
              : '#00AAFF'
          }
        >
          /{highlightQuery}{' '}
          {highlightQuery.length === 0
            ? '(type to filter)'
            : `(${highlightMatches.length} match${highlightMatches.length === 1 ? '' : 'es'})`}
        </text>
      )}

      {/* Confirmation dialog */}
      {pendingAction === 'archive' && selectedWorktree && (
        <Confirm
          message={`Archive worktree ${selectedWorktree.name}?`}
          onConfirm={handleConfirmArchive}
          onCancel={handleCancelAction}
        />
      )}

      {/* Key hints */}
      {!pendingAction && (
        <KeyHints
          hints={
            jumpMode === 'query'
              ? [
                  { key: 'Type', action: 'filter' },
                  { key: 'Backspace', action: 'delete' },
                  { key: 'Enter', action: 'apply' },
                  { key: 'Esc', action: 'cancel' },
                ]
              : jumpMode === 'filtered-nav'
                ? [
                    { key: 'j/k', action: 'next/prev match' },
                    { key: '/', action: 'edit filter' },
                    { key: 'Esc', action: 'clear filter' },
                    { key: 'Enter', action: 'inspect' },
                    { key: 'o', action: 'open' },
                  ]
                : [
                    { key: 'Enter', action: 'inspect' },
                    { key: 'o', action: 'open' },
                    { key: '/', action: 'filter' },
                    { key: 'u', action: 'up' },
                    { key: 'd', action: 'down' },
                    { key: 'a', action: 'archive' },
                    { key: 'r', action: 'refresh' },
                    { key: 'q', action: 'quit' },
                  ]
          }
        />
      )}
    </box>
  )
}

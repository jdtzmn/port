import { useEffect, useRef, useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionJob, EnqueueResult, OutputTailLine } from '../hooks/useActions.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { KeyHints } from '../components/KeyHints.tsx'
import { Confirm } from '../components/Confirm.tsx'

interface Actions {
  upWorktree: (worktreePath: string, worktreeName: string) => EnqueueResult
  downWorktree: (worktreePath: string, worktreeName: string) => EnqueueResult
  archiveWorktree: (worktreePath: string, worktreeName: string) => EnqueueResult
  isWorktreeBusy: (worktreeName: string) => boolean
  latestJobByWorktree: Map<string, ActionJob>
  getOutputTail: (worktreeName: string) => OutputTailLine[]
  isOutputVisible: (worktreeName: string) => boolean
  toggleOutputVisible: (worktreeName: string) => void
  cancelWorktreeAction: (worktreeName: string) => boolean
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

/**
 * Build a plain-text summary of services for a worktree row.
 * Services are sorted running-first upstream; this just joins them
 * with status indicators into a single string like:
 *   "web ● api ● db ○ redis ○"
 */
export function buildServicesText(services: { name: string; running: boolean }[]): string {
  return services.map(s => `${s.name} ${s.running ? '●' : '○'}`).join(' ')
}

function buildHighlightedSegments(text: string, ranges: MatchRange[]): React.ReactNode[] {
  const segments: React.ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push(text.slice(cursor, range.start))
    }
    segments.push(
      <span key={range.start} fg="#00AAFF">
        {text.slice(range.start, range.end)}
      </span>
    )
    cursor = range.end
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor))
  }
  return segments
}

function formatElapsedSeconds(job: ActionJob): string | null {
  if (typeof job.startedAt !== 'number' || typeof job.endedAt !== 'number') {
    return null
  }
  const seconds = Math.max(1, Math.round((job.endedAt - job.startedAt) / 1000))
  return `${seconds}s`
}

function formatRunningSeconds(job: ActionJob): string | null {
  if (typeof job.startedAt !== 'number') {
    return null
  }
  const seconds = Math.max(1, Math.round((Date.now() - job.startedAt) / 1000))
  return `${seconds}s`
}

function formatOutputTitle(
  worktreeName: string,
  latestJob: ActionJob | undefined,
  running: boolean
): string {
  const base = `Output (${worktreeName})`
  if (!latestJob) {
    return running ? `${base} - running` : base
  }

  if (running || latestJob.status === 'running') {
    const elapsed = formatRunningSeconds(latestJob)
    return elapsed ? `${base} - running for ${elapsed}` : `${base} - running`
  }

  const elapsed = formatElapsedSeconds(latestJob)
  if (!elapsed) {
    return base
  }

  if (latestJob.status === 'success') {
    return `${base} - finished in ${elapsed}`
  }
  if (latestJob.status === 'error') {
    return `${base} - failed in ${elapsed}`
  }
  if (latestJob.status === 'cancelled') {
    return `${base} - cancelled in ${elapsed}`
  }

  return base
}

function isOutputEntry(entry: {
  stream: 'stdout' | 'stderr' | 'system'
  line: string
}): entry is { stream: 'stdout' | 'stderr'; line: string } {
  return entry.stream === 'stdout' || entry.stream === 'stderr'
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
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (!initialSelectedName) return 0
    const idx = worktrees.findIndex(w => w.name === initialSelectedName)
    return idx >= 0 ? idx : 0
  })
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [jumpMode, setJumpMode] = useState<JumpMode>('normal')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const initialSelectionAppliedRef = useRef(false)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const outputScrollRef = useRef<ScrollBoxRenderable>(null)

  // Keep selected row visible inside the scrollbox
  useEffect(() => {
    const sb = scrollRef.current
    if (!sb) return
    const viewportHeight = sb.viewport.height
    if (viewportHeight <= 0) return
    if (selectedIndex < sb.scrollTop) {
      sb.scrollTop = selectedIndex
    } else if (selectedIndex >= sb.scrollTop + viewportHeight) {
      sb.scrollTop = selectedIndex - viewportHeight + 1
    }
  }, [selectedIndex])

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
  const selectedLatestJob = selectedWorktree
    ? actions.latestJobByWorktree.get(selectedWorktree.name)
    : undefined
  const selectedRunningAction = selectedWorktree
    ? actions.isWorktreeBusy(selectedWorktree.name)
    : false
  const isRootSelected = selectedIndex === 0
  const highlightQuery =
    jumpMode === 'query' ? draftQuery : jumpMode === 'filtered-nav' ? appliedQuery : ''
  const highlightMatches = findMatchingIndices(worktrees, highlightQuery)
  const selectedOutputTail = selectedWorktree ? actions.getOutputTail(selectedWorktree.name) : []
  const selectedOutputLines =
    selectedLatestJob?.logs
      .filter(isOutputEntry)
      .map(entry => ({ stream: entry.stream, line: entry.line })) ?? selectedOutputTail
  const selectedOutputVisible = selectedWorktree
    ? actions.isOutputVisible(selectedWorktree.name)
    : true
  const hasOutputContext = Boolean(
    selectedWorktree &&
    (selectedRunningAction ||
      selectedOutputTail.length > 0 ||
      selectedOutputLines.length > 0 ||
      selectedLatestJob)
  )
  const showOutput = Boolean(selectedWorktree && selectedOutputVisible && hasOutputContext)
  const showOutputPlaceholder = Boolean(
    selectedWorktree && !selectedOutputVisible && hasOutputContext
  )
  const prevOutputVisibilityRef = useRef(false)
  const prevOutputWorktreeRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedWorktree || !selectedRunningAction) {
      return
    }

    const sb = outputScrollRef.current
    if (!sb) {
      return
    }

    sb.scrollTop = Number.MAX_SAFE_INTEGER
  }, [selectedOutputLines.length, selectedRunningAction, selectedWorktree])

  useEffect(() => {
    const currentWorktree = selectedWorktree?.name ?? null
    const visibilityChangedToShown = showOutput && !prevOutputVisibilityRef.current
    const switchedWorktreeWhileVisible =
      showOutput &&
      prevOutputVisibilityRef.current &&
      prevOutputWorktreeRef.current !== null &&
      prevOutputWorktreeRef.current !== currentWorktree

    if (visibilityChangedToShown || switchedWorktreeWhileVisible) {
      const sb = outputScrollRef.current
      if (sb) {
        sb.scrollTop = Number.MAX_SAFE_INTEGER
      }
    }

    prevOutputVisibilityRef.current = showOutput
    prevOutputWorktreeRef.current = currentWorktree
  }, [showOutput, selectedWorktree])

  useKeyboard(event => {
    if (event.ctrl || event.meta) return

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

    if (event.name === 'c' && selectedWorktree) {
      if (!actions.cancelWorktreeAction(selectedWorktree.name)) {
        showStatus('No running action selected to cancel', 'error')
      }
      return
    }

    if (event.name === 'l' && selectedWorktree) {
      actions.toggleOutputVisible(selectedWorktree.name)
      return
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
          const result = actions.upWorktree(selectedWorktree.path, selectedWorktree.name)
          if (!result.accepted) {
            showStatus(result.message, 'error')
          }
        }
        break
      case 'd':
        if (selectedWorktree) {
          const result = actions.downWorktree(selectedWorktree.path, selectedWorktree.name)
          if (!result.accepted) {
            showStatus(result.message, 'error')
          }
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

    const result = actions.archiveWorktree(selectedWorktree.path, selectedWorktree.name)
    if (!result.accepted) {
      showStatus(result.message, 'error')
      return
    }

    // Optimistically adjust selection while archive runs.
    if (selectedIndex >= worktrees.length - 1) {
      setSelectedIndex(Math.max(0, worktrees.length - 2))
    }
  }

  const handleCancelAction = () => {
    setPendingAction(null)
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text>
          <b>port: {repoName}</b>
        </text>
        {loading && <text fg="#888888"> refreshing...</text>}
      </box>

      <box height={1} flexShrink={0} />

      {/* Traefik status */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg="#888888">Traefik:</text>
        <StatusIndicator running={traefikRunning} />
        <text>{traefikRunning ? 'running' : 'stopped'}</text>
      </box>

      <box height={1} flexShrink={0} />

      {/* Worktree list header */}
      <text fg="#888888" flexShrink={0}>
        <b>Worktrees</b>
      </text>

      <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
        {/* Worktree rows */}
        <scrollbox
          ref={scrollRef}
          flexGrow={0}
          flexShrink={1}
          scrollY
          scrollX={false}
          contentOptions={{ flexDirection: 'column', width: '100%' }}
        >
          {worktrees.length === 0 && !loading && <text fg="#888888">No worktrees found</text>}

          {worktrees.map((worktree, index) => {
            const isSelected = index === selectedIndex
            const isRoot = index === 0
            const isActive = worktree.name === activeWorktreeName
            const sortedServices = [...worktree.services].sort(
              (a, b) => Number(b.running) - Number(a.running)
            )
            const servicesText = buildServicesText(sortedServices)
            const totalCount = worktree.services.length
            const nameStr = worktree.name + (isRoot ? ' (root)' : '')
            const matchRanges = highlightQuery
              ? findSubstringMatchRanges(nameStr, highlightQuery)
              : []
            const latestJob = actions.latestJobByWorktree.get(worktree.name)
            const runningAction = actions.isWorktreeBusy(worktree.name)

            return (
              <box key={worktree.name} flexDirection="row" height={1} overflow="hidden">
                <text wrapMode="none" flexShrink={0}>
                  {isSelected ? '> ' : '  '}
                </text>
                {isActive && (
                  <text wrapMode="none" flexShrink={0} fg="#FFFF00">
                    ★{' '}
                  </text>
                )}
                <text flexShrink={1} wrapMode="none">
                  {matchRanges.length > 0
                    ? buildHighlightedSegments(nameStr, matchRanges)
                    : nameStr}
                </text>
                {runningAction && latestJob && (
                  <text wrapMode="none" flexShrink={0} fg="#FFFF00">
                    {'  ' + latestJob.kind + '...'}
                  </text>
                )}
                {!runningAction && latestJob?.status === 'error' && (
                  <text wrapMode="none" flexShrink={0} fg="#FF4444">
                    {'  ' + latestJob.kind + ' failed'}
                  </text>
                )}
                {totalCount === 0 && loading && (
                  <text wrapMode="none" flexShrink={0} fg="#555555">
                    {' ...'}
                  </text>
                )}
                {totalCount > 0 && (
                  <text wrapMode="none" flexShrink={0}>
                    {'  '}
                  </text>
                )}
                {totalCount > 0 && (
                  <text fg="#888888" flexShrink={100} wrapMode="none">
                    {servicesText}
                  </text>
                )}
                {totalCount > 0 && (
                  <text wrapMode="none" flexShrink={0} fg="#555555">
                    {'  ' + totalCount + ' total'}
                  </text>
                )}
              </box>
            )
          })}
        </scrollbox>

        <box height={1} flexShrink={0} />

        {/* Status message */}
        {statusMessage && (
          <text fg={statusMessage.type === 'success' ? '#00FF00' : '#FF4444'} flexShrink={0}>
            {statusMessage.text}
          </text>
        )}

        {showOutput && selectedWorktree && (
          <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
            <box flexGrow={1} />
            <text fg="#888888" flexShrink={0}>
              <b>
                {formatOutputTitle(selectedWorktree.name, selectedLatestJob, selectedRunningAction)}
              </b>{' '}
              <span fg="#CCCCCC">[l]</span> hide
            </text>
            <scrollbox
              ref={node => {
                outputScrollRef.current = node
                if (node && selectedRunningAction) {
                  node.scrollTop = Number.MAX_SAFE_INTEGER
                }
              }}
              flexGrow={1}
              flexShrink={1}
              minHeight={2}
              scrollY
              scrollX={false}
              contentOptions={{ flexDirection: 'column', width: '100%' }}
            >
              {selectedOutputLines.map((entry, index) => (
                <text
                  key={`${selectedWorktree.name}-output-${index}`}
                  fg={entry.stream === 'stderr' ? '#FF8888' : '#888888'}
                >
                  {entry.line}
                </text>
              ))}
              {selectedOutputLines.length === 0 && <text fg="#666666">No output yet...</text>}
            </scrollbox>
          </box>
        )}

        {showOutputPlaceholder && selectedWorktree && (
          <text fg="#888888" flexShrink={0}>
            <b>
              {formatOutputTitle(selectedWorktree.name, selectedLatestJob, selectedRunningAction)}
            </b>{' '}
            <span fg="#CCCCCC">[l]</span> show
          </text>
        )}
      </box>

      {/* Jump prompt */}
      <text
        flexShrink={0}
        fg={
          jumpMode === 'normal'
            ? '#333333'
            : jumpMode === 'query'
              ? highlightQuery.length === 0
                ? '#888888'
                : highlightMatches.length > 0
                  ? '#00AAFF'
                  : '#FFAA00'
              : '#00AAFF'
        }
      >
        {jumpMode === 'normal'
          ? ' '
          : `/${highlightQuery} ${
              highlightQuery.length === 0
                ? '(type to filter)'
                : `(${highlightMatches.length} match${highlightMatches.length === 1 ? '' : 'es'})`
            }`}
      </text>

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
        <box flexShrink={0}>
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
                      ...(selectedWorktree && selectedRunningAction
                        ? [{ key: 'c', action: 'cancel running' }]
                        : []),
                      { key: 'r', action: 'refresh' },
                      { key: 'q', action: 'quit' },
                    ]
            }
          />
        </box>
      )}
    </box>
  )
}

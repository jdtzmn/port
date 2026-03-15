import { useEffect, useRef, useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { KeyHints } from '../components/KeyHints.tsx'
import { Confirm } from '../components/Confirm.tsx'
import { useFilterNavigation } from '../hooks/useFilterNavigation.ts'
import { findSubstringMatchRanges, type MatchRange } from '../lib/filtering.ts'

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
  const [busy, setBusy] = useState(false)
  const initialSelectionAppliedRef = useRef(false)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const {
    mode,
    highlightQuery,
    highlightMatches,
    handleKey: handleFilterKey,
  } = useFilterNavigation({
    items: worktrees,
    setSelectedIndex,
    getSearchText: worktree => worktree.name,
  })

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

  const selectedWorktree = worktrees[selectedIndex]
  const isRootSelected = selectedIndex === 0

  useKeyboard(event => {
    if (event.ctrl || event.meta || busy) return

    const keySequence = (event as { sequence?: string }).sequence
    const maxIndex = worktrees.length - 1

    // If we're in a confirm dialog, don't handle navigation
    if (pendingAction) return

    if (handleFilterKey({ eventName: event.name, keySequence })) {
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
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text>
          <b>port: {repoName}</b>
        </text>
        {loading && <text fg="#888888"> refreshing...</text>}
        {busy && <text fg="#FFFF00"> working...</text>}
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

      {/* Worktree rows */}
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
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
                {matchRanges.length > 0 ? buildHighlightedSegments(nameStr, matchRanges) : nameStr}
              </text>
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
        <text fg={statusMessage.type === 'success' ? '#00FF00' : '#FF4444'}>
          {statusMessage.text}
        </text>
      )}

      {/* Jump prompt */}
      {mode !== 'normal' && (
        <text
          fg={
            mode === 'query'
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
            mode === 'query'
              ? [
                  { key: 'Type', action: 'filter' },
                  { key: 'Backspace', action: 'delete' },
                  { key: 'Enter', action: 'apply' },
                  { key: 'Esc', action: 'cancel' },
                ]
              : mode === 'filtered-nav'
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

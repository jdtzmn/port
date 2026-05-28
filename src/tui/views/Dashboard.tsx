import { useEffect, useMemo, useRef, useState } from 'react'
import { StyledText, bold, fg, stringToStyledText, type TextChunk } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { Confirm } from '../components/Confirm.tsx'
import { useFilterNavigation } from '../hooks/useFilterNavigation.ts'
import { SelectableRow } from '../components/SelectableRow.tsx'
import { findSubstringMatchRanges, type MatchRange } from '../lib/filtering.ts'
import { orderWorktreesForDashboard } from '../lib/worktreeOrdering.ts'
import { isQuestionMarkKey, useTuiInteraction } from '../lib/interaction.tsx'

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
  selectedWorktreeName?: string | null
  onSelectedWorktreeNameChange?: (name: string) => void
  actions: Actions
  refresh: () => void
  loading: boolean
  statusMessage: { text: string; type: 'success' | 'error' } | null
  showStatus: (text: string, type: 'success' | 'error') => void
  keyboardEnabled?: boolean
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

function buildHighlightedContent(text: string, ranges: MatchRange[], isBold: boolean): StyledText {
  const chunks: TextChunk[] = []
  let cursor = 0

  const pushChunk = (chunk: TextChunk) => {
    chunks.push(isBold ? bold(chunk) : chunk)
  }

  for (const range of ranges) {
    if (range.start > cursor) {
      for (const chunk of stringToStyledText(text.slice(cursor, range.start)).chunks) {
        pushChunk(chunk)
      }
    }
    pushChunk(
      isBold
        ? bold(fg('#00AAFF')(text.slice(range.start, range.end)))
        : fg('#00AAFF')(text.slice(range.start, range.end))
    )
    cursor = range.end
  }
  if (cursor < text.length) {
    for (const chunk of stringToStyledText(text.slice(cursor)).chunks) {
      pushChunk(chunk)
    }
  }
  return new StyledText(chunks)
}

export function Dashboard({
  repoRoot,
  worktrees,
  onSelectWorktree,
  onOpenWorktree,
  activeWorktreeName,
  initialSelectedName,
  actions,
  loading,
  statusMessage,
  showStatus,
  keyboardEnabled = true,
  selectedWorktreeName,
  onSelectedWorktreeNameChange,
}: DashboardProps) {
  const { dispatch } = useTuiInteraction()
  const orderedWorktrees = useMemo(
    () => orderWorktreesForDashboard(worktrees, activeWorktreeName),
    [worktrees, activeWorktreeName]
  )

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const initialName = selectedWorktreeName ?? initialSelectedName
    if (!initialName) return 0
    const idx = orderedWorktrees.findIndex(w => w.name === initialName)
    return idx >= 0 ? idx : 0
  })
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const {
    mode,
    highlightQuery,
    highlightMatches,
    handleKey: handleFilterKey,
  } = useFilterNavigation({
    items: orderedWorktrees,
    setSelectedIndex,
    getSearchText: worktree => worktree.name,
  })

  useEffect(() => {
    dispatch({ type: 'set-pane-mode', pane: 'worktrees', mode })
  }, [dispatch, mode])

  useEffect(() => {
    if (pendingAction) {
      dispatch({ type: 'begin-confirm', action: pendingAction })
    } else {
      dispatch({ type: 'end-confirm' })
    }
  }, [dispatch, pendingAction])

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
    if (orderedWorktrees.length === 0) {
      return
    }

    const targetName = selectedWorktreeName ?? initialSelectedName
    if (!targetName) return

    const idx = orderedWorktrees.findIndex(w => w.name === targetName)
    if (idx >= 0) {
      setSelectedIndex(idx)
    }
  }, [initialSelectedName, orderedWorktrees, selectedWorktreeName])

  const selectedWorktree = orderedWorktrees[selectedIndex]
  const isRootSelected = selectedWorktree?.path === repoRoot

  useKeyboard(event => {
    if (!keyboardEnabled || event.ctrl || event.meta || busy) return

    const keySequence = (event as { sequence?: string }).sequence
    if (isQuestionMarkKey(event.name, keySequence, event.shift)) return
    const maxIndex = orderedWorktrees.length - 1

    // If we're in a confirm dialog, don't handle navigation
    if (pendingAction) return

    if (handleFilterKey({ eventName: event.name, keySequence })) {
      return
    }

    switch (event.name) {
      case 'j':
      case 'down':
        setSelectedIndex(i => {
          const nextIndex = Math.min(i + 1, maxIndex)
          const nextName = orderedWorktrees[nextIndex]?.name
          if (nextName && nextName !== selectedWorktreeName) {
            onSelectedWorktreeNameChange?.(nextName)
          }
          return nextIndex
        })
        break
      case 'k':
      case 'up':
        setSelectedIndex(i => {
          const nextIndex = Math.max(i - 1, 0)
          const nextName = orderedWorktrees[nextIndex]?.name
          if (nextName && nextName !== selectedWorktreeName) {
            onSelectedWorktreeNameChange?.(nextName)
          }
          return nextIndex
        })
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
        if (selectedIndex >= orderedWorktrees.length - 1) {
          const nextIndex = Math.max(0, orderedWorktrees.length - 2)
          setSelectedIndex(nextIndex)
          const nextName = orderedWorktrees[nextIndex]?.name
          if (nextName && nextName !== selectedWorktreeName) {
            onSelectedWorktreeNameChange?.(nextName)
          }
        }
      })
      .finally(() => setBusy(false))
  }

  const handleCancelAction = () => {
    setPendingAction(null)
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: 'column', width: '100%' }}
      >
        {orderedWorktrees.length === 0 && !loading && <text fg="#888888">No worktrees found</text>}

        {orderedWorktrees.map((worktree, index) => {
          const isSelected = index === selectedIndex
          const isRoot = worktree.path === repoRoot
          const isActive = worktree.name === activeWorktreeName
          const baseName = worktree.name
          const displayName = baseName + (isRoot ? ' (root)' : '')
          const matchRanges = highlightQuery
            ? findSubstringMatchRanges(baseName, highlightQuery)
            : []

          return (
            <SelectableRow key={worktree.name} selected={isSelected}>
              <StatusIndicator running={worktree.running} />
              <text
                flexGrow={1}
                flexShrink={1}
                wrapMode="none"
                truncate
                content={
                  matchRanges.length > 0
                    ? new StyledText([
                        ...buildHighlightedContent(baseName, matchRanges, isActive).chunks,
                        ...stringToStyledText(isRoot ? ' (root)' : '').chunks,
                      ])
                    : new StyledText([
                        ...stringToStyledText(displayName).chunks.map(chunk =>
                          isActive ? bold(chunk) : chunk
                        ),
                      ])
                }
              />
              {isActive && (
                <text wrapMode="none" flexShrink={0} fg="#FFFF00">
                  ▣{' '}
                </text>
              )}
            </SelectableRow>
          )
        })}
      </scrollbox>

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
    </box>
  )
}

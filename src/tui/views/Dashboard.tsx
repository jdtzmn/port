import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
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
  actions: Actions
  refresh: () => void
  loading: boolean
  statusMessage: { text: string; type: 'success' | 'error' } | null
  showStatus: (text: string, type: 'success' | 'error') => void
}

type PendingAction = 'archive' | null

export function Dashboard({
  repoName,
  worktrees,
  traefikRunning,
  onSelectWorktree,
  onOpenWorktree,
  activeWorktreeName,
  actions,
  loading,
  statusMessage,
  showStatus,
}: DashboardProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)

  const selectedWorktree = worktrees[selectedIndex]
  const isRootSelected = selectedIndex === 0

  useKeyboard(event => {
    if (event.ctrl || event.meta || busy) return

    // If we're in a confirm dialog, don't handle navigation
    if (pendingAction) return

    const maxIndex = worktrees.length - 1

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

        return (
          <box key={worktree.name} flexDirection="row" gap={1}>
            <text>{isSelected ? '>' : ' '}</text>
            {isActive && <text fg="#FFFF00">★</text>}
            <text>
              {isSelected ? (
                <b>
                  {worktree.name}
                  {isRoot ? ' (root)' : ''}
                </b>
              ) : (
                <>
                  {worktree.name}
                  {isRoot ? ' (root)' : ''}
                </>
              )}
            </text>
            {worktree.services.map(service => (
              <box key={service.name} flexDirection="row" gap={0}>
                <text fg="#888888">{service.name} </text>
                <StatusIndicator running={service.running} />
              </box>
            ))}
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
          hints={[
            { key: 'Enter', action: 'inspect' },
            { key: 'o', action: 'enter' },
            { key: 'u', action: 'up' },
            { key: 'd', action: 'down' },
            { key: 'a', action: 'archive' },
            { key: 'r', action: 'refresh' },
            { key: 'q', action: 'quit' },
          ]}
        />
      )}
    </box>
  )
}

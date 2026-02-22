import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { KeyHints } from '../components/KeyHints.tsx'

interface DashboardProps {
  repoRoot: string
  repoName: string
  worktrees: WorktreeStatus[]
  hostServices: HostService[]
  traefikRunning: boolean
  config: PortConfig
  onSelectWorktree: (name: string) => void
  refresh: () => void
  loading: boolean
}

export function Dashboard({
  repoName,
  worktrees,
  traefikRunning,
  onSelectWorktree,
  loading,
}: DashboardProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useKeyboard(event => {
    if (event.ctrl || event.meta) return

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
      case 'return': {
        const selected = worktrees[selectedIndex]
        if (selected) {
          onSelectWorktree(selected.name)
        }
        break
      }
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text>
          <b>port: {repoName}</b>
        </text>
        {loading && <text fg="#888888"> refreshing...</text>}
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

        return (
          <box key={worktree.name} flexDirection="row" gap={1}>
            <text>{isSelected ? '>' : ' '}</text>
            {isRoot && <text fg="#FFFF00">★</text>}
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

      {/* Key hints */}
      <KeyHints
        hints={[
          { key: 'Enter', action: 'open' },
          { key: 'u', action: 'up' },
          { key: 'd', action: 'down' },
          { key: 'a', action: 'archive' },
          { key: 'r', action: 'refresh' },
          { key: 'q', action: 'quit' },
        ]}
      />
    </box>
  )
}

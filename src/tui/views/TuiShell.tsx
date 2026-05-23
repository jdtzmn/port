import { useEffect, useMemo, useState } from 'react'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { Dashboard } from './Dashboard.tsx'
import { WorktreeView } from './WorktreeView.tsx'
import { KeyHints, type KeyHint } from '../components/KeyHints.tsx'
import { PortStatusDot } from '../components/PortStatusDot.tsx'
import {
  adjustSplitPercent,
  computePaneWidths,
  resolveShellPaneKey,
  type ActivePane,
} from '../lib/paneLayout.ts'

interface Actions {
  upWorktree: (worktreePath: string, worktreeName: string) => Promise<ActionResult>
  downWorktree: (worktreePath: string, worktreeName: string) => Promise<ActionResult>
  archiveWorktree: (worktreePath: string, worktreeName: string) => Promise<ActionResult>
  killHostService: (service: HostService) => Promise<ActionResult>
}

interface TuiShellProps {
  repoRoot: string
  repoName: string
  activeWorktreeName: string
  activeWorktreePath: string
  worktrees: WorktreeStatus[]
  hostServices: HostService[]
  traefikRunning: boolean
  config: PortConfig
  actions: Actions
  refresh: () => void
  loading: boolean
  statusMessage: { text: string; type: 'success' | 'error' } | null
  showStatus: (text: string, type: 'success' | 'error') => void
  requestExit: (info: { activeWorktreeName: string; worktreePath: string; changed: boolean }) => void
}

const PANES = {
  worktrees: 'worktrees' as ActivePane,
  services: 'services' as ActivePane,
}

export function TuiShell({
  repoRoot,
  repoName,
  activeWorktreeName,
  activeWorktreePath,
  worktrees,
  hostServices,
  traefikRunning,
  config,
  actions,
  refresh,
  loading,
  statusMessage,
  showStatus,
  requestExit,
}: TuiShellProps) {
  const [activePane, setActivePane] = useState<ActivePane>(PANES.worktrees)
  const [splitPercent, setSplitPercent] = useState(1 / 3)
  const [selectedWorktreeName, setSelectedWorktreeName] = useState(activeWorktreeName)
  const [worktreeFooterHints, setWorktreeFooterHints] = useState<KeyHint[]>([])
  const [serviceFooterHints, setServiceFooterHints] = useState<KeyHint[]>([])
  const { width } = useTerminalDimensions()

  const currentSelectedWorktree = useMemo(() => {
    return worktrees.find(w => w.name === selectedWorktreeName) ?? worktrees[0] ?? null
  }, [selectedWorktreeName, worktrees])

  useEffect(() => {
    if (!currentSelectedWorktree) return
    if (currentSelectedWorktree.name !== selectedWorktreeName) {
      setSelectedWorktreeName(currentSelectedWorktree.name)
    }
  }, [currentSelectedWorktree, selectedWorktreeName])

  const split = computePaneWidths(width, splitPercent)
  const activeWorktreeHostServices = hostServices.filter(
    s => s.repo === repoRoot && s.branch === currentSelectedWorktree?.name
  )
  const portStatus = loading ? 'unknown' : traefikRunning ? 'running' : 'stopped'

  useKeyboard(event => {
    if (event.ctrl || event.meta) return

    if (event.name === 'q' || event.name === 'escape') {
      requestExit({
        activeWorktreeName,
        worktreePath: activeWorktreePath,
        changed: false,
      })
      return
    }

    const shellKeyAction = resolveShellPaneKey(activePane, event.name, event.shift)
    if (shellKeyAction === PANES.worktrees || shellKeyAction === PANES.services) {
      setActivePane(shellKeyAction)
      return
    }

    if (shellKeyAction === 'resize-left') {
      setSplitPercent(current => adjustSplitPercent(current, 'left'))
      return
    }

    if (shellKeyAction === 'resize-right') {
      setSplitPercent(current => adjustSplitPercent(current, 'right'))
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" flexGrow={1}>
      <box
        width={split.leftWidth}
        height="100%"
        borderStyle="rounded"
        borderColor={activePane === PANES.worktrees ? '#00AAFF' : '#555555'}
        title="Worktrees"
        padding={0}
      >
        <Dashboard
          repoRoot={repoRoot}
          repoName={repoName}
          worktrees={worktrees}
          hostServices={hostServices}
          traefikRunning={traefikRunning}
          config={config}
          onSelectWorktree={name => {
            setActivePane(PANES.services)
            setSelectedWorktreeName(name)
          }}
          onOpenWorktree={name => {
            setSelectedWorktreeName(name)
            setActivePane(PANES.services)
          }}
          activeWorktreeName={activeWorktreeName}
          initialSelectedName={selectedWorktreeName}
          selectedWorktreeName={selectedWorktreeName}
          onSelectedWorktreeNameChange={setSelectedWorktreeName}
          actions={actions}
          refresh={refresh}
          loading={loading}
          statusMessage={statusMessage}
          showStatus={showStatus}
          keyboardEnabled={activePane === PANES.worktrees}
          onFooterHintsChange={setWorktreeFooterHints}
        />
      </box>

      <box
        width={split.rightWidth}
        height="100%"
        borderStyle="rounded"
        borderColor={activePane === PANES.services ? '#00AAFF' : '#555555'}
        title="Services"
        padding={0}
      >
        <WorktreeView
          key={currentSelectedWorktree?.name ?? 'empty'}
          worktree={currentSelectedWorktree}
          hostServices={activeWorktreeHostServices}
          config={config}
          repoRoot={repoRoot}
          onBack={() => setActivePane(PANES.worktrees)}
          actions={actions}
          refresh={refresh}
          loading={loading}
          statusMessage={statusMessage}
          showStatus={showStatus}
          keyboardEnabled={activePane === PANES.services}
          onFooterHintsChange={setServiceFooterHints}
        />
      </box>
      </box>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0} height={1} paddingX={1}>
        <KeyHints hints={activePane === PANES.worktrees ? worktreeFooterHints : serviceFooterHints} />
        <box flexDirection="row" gap={1} flexShrink={0}>
          <PortStatusDot status={portStatus} />
          <text fg="#888888" wrapMode="none">
            Port
          </text>
          {!loading && (
            <text fg="#888888" wrapMode="none">
              {traefikRunning ? 'Running' : 'Stopped'}
            </text>
          )}
        </box>
      </box>
    </box>
  )
}

import { useEffect, useMemo, useReducer, useState } from 'react'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { Dashboard } from './Dashboard.tsx'
import { HelpDialog } from '../components/HelpDialog.tsx'
import { WorktreeView } from './WorktreeView.tsx'
import { KeyHints, type KeyHint } from '../components/KeyHints.tsx'
import { PortStatusDot } from '../components/PortStatusDot.tsx'
import {
  DEFAULT_TUI_INTERACTION_STATE,
  TuiInteractionContext,
  getHelpSections,
  getFooterHints,
  isQuestionMarkKey,
  tuiInteractionReducer,
} from '../lib/interaction.tsx'
import { fitKeyHintsToWidth } from '../lib/commands.ts'
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
  const [interaction, dispatch] = useReducer(tuiInteractionReducer, DEFAULT_TUI_INTERACTION_STATE)
  const [splitPercent, setSplitPercent] = useState(1 / 3)
  const [selectedWorktreeName, setSelectedWorktreeName] = useState(activeWorktreeName)
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
  const activePane = interaction.activePane
  const footerHints = useMemo<KeyHint[]>(() => getFooterHints(interaction), [interaction])
  const portStatusLabel = !loading ? (traefikRunning ? 'Running' : 'Stopped') : null
  const footerPortWidth = portStatusLabel ? 14 : 6
  const footerLeftHints = useMemo<KeyHint[]>(() => {
    return fitKeyHintsToWidth(footerHints, Math.max(0, width - footerPortWidth - 3))
  }, [footerHints, footerPortWidth, width])
  const helpSections = useMemo(() => getHelpSections(interaction), [interaction])
  const helpWidth = Math.max(60, Math.min(width - 6, 86))

  useKeyboard(event => {
    if (event.ctrl || event.meta) return
    const keySequence = (event as { sequence?: string }).sequence
    const isQuestionMark = isQuestionMarkKey(event.name, keySequence, event.shift)

    if (event.name === 'q') {
      requestExit({
        activeWorktreeName,
        worktreePath: activeWorktreePath,
        changed: false,
      })
      return
    }

    if (interaction.helpOpen) {
      if (event.name === 'escape' || event.name === 'esc' || isQuestionMark) {
        dispatch({ type: 'close-help' })
      }
      return
    }

    if (interaction.pendingAction || interaction.palette.open) {
      return
    }

    if (isQuestionMark) {
      dispatch({ type: 'toggle-help' })
      return
    }

    const shellKeyAction = resolveShellPaneKey(activePane, event.name, event.shift)
    if (shellKeyAction === PANES.worktrees || shellKeyAction === PANES.services) {
      dispatch({ type: 'set-active-pane', pane: shellKeyAction })
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
          <TuiInteractionContext.Provider value={{ state: interaction, dispatch }}>
            <Dashboard
              repoRoot={repoRoot}
              repoName={repoName}
              worktrees={worktrees}
              hostServices={hostServices}
              traefikRunning={traefikRunning}
              config={config}
              onSelectWorktree={name => {
                setSelectedWorktreeName(name)
                dispatch({ type: 'set-active-pane', pane: PANES.services })
                dispatch({ type: 'set-pane-mode', pane: PANES.services, mode: 'normal' })
              }}
              onOpenWorktree={name => {
                setSelectedWorktreeName(name)
                dispatch({ type: 'set-active-pane', pane: PANES.services })
                dispatch({ type: 'set-pane-mode', pane: PANES.services, mode: 'normal' })
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
              keyboardEnabled={activePane === PANES.worktrees && !interaction.helpOpen}
            />
          </TuiInteractionContext.Provider>
        </box>

        <box
          width={split.rightWidth}
          height="100%"
          borderStyle="rounded"
          borderColor={activePane === PANES.services ? '#00AAFF' : '#555555'}
          title="Services"
          padding={0}
        >
          <TuiInteractionContext.Provider value={{ state: interaction, dispatch }}>
            <WorktreeView
              key={currentSelectedWorktree?.name ?? 'empty'}
              worktree={currentSelectedWorktree}
              hostServices={activeWorktreeHostServices}
              config={config}
              repoRoot={repoRoot}
              onBack={() => {
                dispatch({ type: 'set-active-pane', pane: PANES.worktrees })
                dispatch({ type: 'set-pane-mode', pane: PANES.services, mode: 'normal' })
              }}
              actions={actions}
              refresh={refresh}
              loading={loading}
              statusMessage={statusMessage}
              showStatus={showStatus}
              keyboardEnabled={activePane === PANES.services && !interaction.helpOpen}
            />
          </TuiInteractionContext.Provider>
        </box>
      </box>

      {interaction.helpOpen && (
        <box
          position="absolute"
          left={0}
          top={0}
          right={0}
          bottom={1}
        >
          <box flexDirection="row" width="100%" height="100%" alignItems="center" justifyContent="center">
          <TuiInteractionContext.Provider value={{ state: interaction, dispatch }}>
            <HelpDialog title="Keyboard Shortcuts" sections={helpSections} width={helpWidth} />
          </TuiInteractionContext.Provider>
          </box>
        </box>
      )}

      <box flexDirection="row" flexShrink={0} height={1} paddingX={1} gap={1}>
        <box flexDirection="row" width={Math.max(0, width - footerPortWidth - 3)} flexShrink={0} overflow="hidden">
          <KeyHints hints={footerLeftHints} />
        </box>
        <box flexDirection="row" gap={1} flexShrink={0} width={footerPortWidth}>
          <PortStatusDot status={portStatus} />
          <text fg="#888888" wrapMode="none">
            Port
          </text>
          {portStatusLabel && (
            <text fg="#888888" wrapMode="none">
              {portStatusLabel}
            </text>
          )}
        </box>
      </box>
    </box>
  )
}

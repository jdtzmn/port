import { useState, useCallback, useRef } from 'react'
import { useKeyboard } from '@opentui/react'
import type { WorktreeInfo, PortConfig } from '../types.ts'
import type { StartView, ExitInfo } from './index.tsx'
import { Dashboard } from './views/Dashboard.tsx'
import { WorktreeView } from './views/WorktreeView.tsx'
import { usePortData } from './hooks/usePortData.ts'
import { useActions } from './hooks/useActions.ts'

interface AppProps {
  startView: StartView
  context: WorktreeInfo
  config: PortConfig
  requestExit: (info: ExitInfo) => void
}

export function App({ startView, context, config, requestExit }: AppProps) {
  const [currentView, setCurrentView] = useState<'dashboard' | 'worktree'>(startView)
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(
    startView === 'worktree' ? context.name : null
  )
  const [statusMessage, setStatusMessage] = useState<{
    text: string
    type: 'success' | 'error'
  } | null>(null)

  // Track which worktree is "active" (where the shell will cd on exit).
  const [activeWorktreeName, setActiveWorktreeName] = useState<string>(context.name)

  // Refs so the exit handler always reads the latest values
  const activeWorktreeRef = useRef(activeWorktreeName)
  activeWorktreeRef.current = activeWorktreeName

  const { worktrees, hostServices, traefikRunning, loading, error, refresh } = usePortData(
    context.repoRoot,
    config
  )

  // Show data loading errors as status messages
  if (error && !statusMessage) {
    setStatusMessage({ text: error, type: 'error' })
  }

  const actions = useActions(context.repoRoot, config, refresh)

  const showStatus = useCallback((text: string, type: 'success' | 'error') => {
    setStatusMessage({ text, type })
    setTimeout(() => setStatusMessage(null), 3000)
  }, [])

  const handleSelectWorktree = useCallback((name: string) => {
    setSelectedWorktree(name)
    setCurrentView('worktree')
  }, [])

  const handleBack = useCallback(() => {
    setCurrentView('dashboard')
  }, [])

  const handleOpenWorktree = useCallback(
    (name: string) => {
      const selectedWt = worktrees.find(w => w.name === name)

      requestExit({
        activeWorktreeName: name,
        worktreePath: selectedWt?.path ?? context.worktreePath,
        changed: name !== context.name,
      })
    },
    [worktrees, context, requestExit]
  )

  const handleExit = useCallback(() => {
    const activeName = activeWorktreeRef.current
    const activeWt = worktrees.find(w => w.name === activeName)
    const worktreePath = activeWt?.path ?? context.worktreePath

    requestExit({
      activeWorktreeName: activeName,
      worktreePath,
      changed: activeName !== context.name,
    })
  }, [worktrees, context, requestExit])

  useKeyboard(event => {
    if (event.name === 'q' && !event.ctrl && !event.meta) {
      handleExit()
    }
    if (event.name === 'c' && event.ctrl) {
      handleExit()
    }
    if (event.name === 'r' && !event.ctrl && !event.meta) {
      refresh()
    }
  })

  if (currentView === 'worktree' && selectedWorktree) {
    const worktree = worktrees.find(w => w.name === selectedWorktree)
    const worktreeHostServices = hostServices.filter(
      s => s.repo === context.repoRoot && s.branch === selectedWorktree
    )

    return (
      <WorktreeView
        worktree={worktree ?? null}
        hostServices={worktreeHostServices}
        config={config}
        repoRoot={context.repoRoot}
        onBack={handleBack}
        actions={actions}
        refresh={refresh}
        loading={loading}
        statusMessage={statusMessage}
        showStatus={showStatus}
      />
    )
  }

  return (
    <Dashboard
      repoRoot={context.repoRoot}
      repoName={context.name}
      worktrees={worktrees}
      hostServices={hostServices}
      traefikRunning={traefikRunning}
      config={config}
      onSelectWorktree={handleSelectWorktree}
      onOpenWorktree={handleOpenWorktree}
      activeWorktreeName={activeWorktreeName}
      initialSelectedName={selectedWorktree}
      actions={actions}
      refresh={refresh}
      loading={loading}
      statusMessage={statusMessage}
      showStatus={showStatus}
    />
  )
}

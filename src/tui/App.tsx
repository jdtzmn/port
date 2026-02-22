import { useState, useCallback } from 'react'
import { useKeyboard } from '@opentui/react'
import type { WorktreeInfo, PortConfig } from '../types.ts'
import type { StartView } from './index.tsx'
import { Dashboard } from './views/Dashboard.tsx'
import { WorktreeView } from './views/WorktreeView.tsx'
import { usePortData } from './hooks/usePortData.ts'
import { useActions } from './hooks/useActions.ts'

interface AppProps {
  startView: StartView
  context: WorktreeInfo
  config: PortConfig
}

export function App({ startView, context, config }: AppProps) {
  const [currentView, setCurrentView] = useState<'dashboard' | 'worktree'>(startView)
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(
    startView === 'worktree' ? context.name : null
  )
  const [statusMessage, setStatusMessage] = useState<{
    text: string
    type: 'success' | 'error'
  } | null>(null)

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
    setSelectedWorktree(null)
  }, [])

  useKeyboard(event => {
    if (event.name === 'q' && !event.ctrl && !event.meta) {
      process.exit(0)
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
      actions={actions}
      refresh={refresh}
      loading={loading}
      statusMessage={statusMessage}
      showStatus={showStatus}
    />
  )
}

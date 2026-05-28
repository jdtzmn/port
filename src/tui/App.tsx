import { useState, useCallback } from 'react'
import type { WorktreeInfo, PortConfig } from '../types.ts'
import type { StartView, ExitInfo } from './index.tsx'
import { usePortData } from './hooks/usePortData.ts'
import { useActions } from './hooks/useActions.ts'
import { TuiShell } from './views/TuiShell.tsx'

interface AppProps {
  startView: StartView
  context: WorktreeInfo
  config: PortConfig
  requestExit: (info: ExitInfo) => void
}

export function App(props: AppProps) {
  const [statusMessage, setStatusMessage] = useState<{
    text: string
    type: 'success' | 'error'
  } | null>(null)

  const { worktrees, hostServices, traefikRunning, loading, error, refresh } = usePortData(
    props.context.repoRoot,
    props.config
  )

  // Show data loading errors as status messages
  if (error && !statusMessage) {
    setStatusMessage({ text: error, type: 'error' })
  }

  const actions = useActions(props.context.repoRoot, props.config, refresh)

  const showStatus = useCallback((text: string, type: 'success' | 'error') => {
    setStatusMessage({ text, type })
    setTimeout(() => setStatusMessage(null), 3000)
  }, [])

  return (
    <TuiShell
      repoRoot={props.context.repoRoot}
      repoName={props.context.name}
      activeWorktreeName={props.context.name}
      activeWorktreePath={props.context.worktreePath}
      worktrees={worktrees}
      hostServices={hostServices}
      traefikRunning={traefikRunning}
      config={props.config}
      actions={actions}
      refresh={refresh}
      loading={loading}
      statusMessage={statusMessage}
      showStatus={showStatus}
      requestExit={props.requestExit}
    />
  )
}

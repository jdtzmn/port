import { useState, useCallback, useRef } from 'react'
import { useKeyboard } from '@opentui/react'
import type { WorktreeInfo, PortConfig } from '../types.ts'
import type { StartView, ExitInfo } from './index.tsx'
import { Dashboard } from './views/Dashboard.tsx'
import { WorktreeView } from './views/WorktreeView.tsx'
import { usePortData } from './hooks/usePortData.ts'
import { useActions } from './hooks/useActions.ts'

export async function runGracefulExit(params: {
  getExitInfo: () => ExitInfo
  requestExit: (info: ExitInfo) => void
  getRunningActionCount: () => number
  shutdownJobs: (options?: { timeoutMs?: number }) => Promise<{
    cancelledCount: number
    timedOut: boolean
    remaining: number
  }>
  setStatus: (text: string, type: 'success' | 'error') => void
  setExiting: (exiting: boolean) => void
}): Promise<void> {
  params.setExiting(true)
  const runningCount = params.getRunningActionCount()
  if (runningCount > 0) {
    params.setStatus(
      `Exiting... cancelling ${runningCount} running action${runningCount === 1 ? '' : 's'}`,
      'success'
    )
    const shutdown = await params.shutdownJobs({ timeoutMs: 5000 })
    if (shutdown.timedOut) {
      params.setStatus(
        `Shutdown timed out with ${shutdown.remaining} action${shutdown.remaining === 1 ? '' : 's'} still running`,
        'error'
      )
    }
  }

  params.requestExit(params.getExitInfo())
}

interface AppProps {
  startView: StartView
  context: WorktreeInfo
  config: PortConfig
  requestExit: (info: ExitInfo) => void
}

export function App({ startView, context, config, requestExit }: AppProps) {
  const [currentView, setCurrentView] = useState<'dashboard' | 'worktree'>(startView)
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(context.name)
  const [statusMessage, setStatusMessage] = useState<{
    text: string
    type: 'success' | 'error'
  } | null>(null)
  const [isExiting, setIsExiting] = useState(false)
  const exitingRef = useRef(false)

  // Track which worktree is "active" (where the shell will cd on exit).
  const activeWorktreeName = context.name

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
    if (exitingRef.current) {
      setStatusMessage({ text, type })
      return
    }
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

  const buildExitInfo = useCallback((): ExitInfo => {
    const activeName = activeWorktreeName
    const activeWt = worktrees.find(w => w.name === activeName)
    const worktreePath = activeWt?.path ?? context.worktreePath

    return {
      activeWorktreeName: activeName,
      worktreePath,
      changed: activeName !== context.name,
    }
  }, [activeWorktreeName, worktrees, context])

  const handleExit = useCallback(async () => {
    if (exitingRef.current) {
      return
    }
    exitingRef.current = true

    await runGracefulExit({
      getExitInfo: buildExitInfo,
      requestExit,
      getRunningActionCount: actions.getRunningActionCount,
      shutdownJobs: actions.shutdownJobs,
      setStatus: (text, type) => setStatusMessage({ text, type }),
      setExiting: setIsExiting,
    })
  }, [actions.getRunningActionCount, actions.shutdownJobs, buildExitInfo, requestExit])

  const handleForceExit = useCallback(() => {
    requestExit(buildExitInfo())
  }, [buildExitInfo, requestExit])

  useKeyboard(event => {
    if (event.name === 'q' && !event.ctrl && !event.meta) {
      void handleExit()
    }
    if (event.name === 'c' && event.ctrl) {
      if (exitingRef.current) {
        handleForceExit()
      } else {
        void handleExit()
      }
    }
    if (event.name === 'r' && !event.ctrl && !event.meta) {
      if (isExiting) return
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

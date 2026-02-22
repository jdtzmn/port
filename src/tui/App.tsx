import { useState, useCallback, useRef, useEffect } from 'react'
import { useKeyboard } from '@opentui/react'
import type { WorktreeInfo, PortConfig } from '../types.ts'
import type { StartView } from './index.tsx'
import { Dashboard } from './views/Dashboard.tsx'
import { WorktreeView } from './views/WorktreeView.tsx'
import { usePortData } from './hooks/usePortData.ts'
import { useActions } from './hooks/useActions.ts'
import {
  getEvalContext,
  buildEnterCommands,
  buildExitCommands,
  writeEvalFile,
} from '../lib/shell.ts'

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

  // Track which worktree is "active" (where the shell will cd on exit).
  // Initialized to whatever worktree/root the user launched from.
  const [activeWorktreeName, setActiveWorktreeName] = useState<string>(context.name)

  // Use a ref so the exit handler always reads the latest value
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
    setSelectedWorktree(null)
  }, [])

  const handleOpenWorktree = useCallback(
    (name: string) => {
      setActiveWorktreeName(name)
      showStatus(`Entered ${name}`, 'success')
    },
    [showStatus]
  )

  // Write shell eval commands on exit so the shell cd's to the active worktree.
  useEffect(() => {
    const exitHandler = () => {
      const evalCtx = getEvalContext()
      if (!evalCtx) return

      const activeName = activeWorktreeRef.current
      const activeWt = worktrees.find(w => w.name === activeName)
      const worktreePath = activeWt?.path ?? context.worktreePath

      // If the active worktree is the repo root, exit to root
      if (worktreePath === context.repoRoot) {
        const commands = buildExitCommands(evalCtx.shell, context.repoRoot)
        writeEvalFile(commands, evalCtx.evalFile)
      } else {
        const commands = buildEnterCommands(
          evalCtx.shell,
          worktreePath,
          activeName,
          context.repoRoot
        )
        writeEvalFile(commands, evalCtx.evalFile)
      }
    }

    process.on('exit', exitHandler)
    return () => {
      process.removeListener('exit', exitHandler)
    }
  }, [context, worktrees])

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
      onOpenWorktree={handleOpenWorktree}
      activeWorktreeName={activeWorktreeName}
      actions={actions}
      refresh={refresh}
      loading={loading}
      statusMessage={statusMessage}
      showStatus={showStatus}
    />
  )
}

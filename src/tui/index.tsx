import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import type { WorktreeInfo, PortConfig } from '../types.ts'
import {
  getEvalContext,
  buildEnterCommands,
  buildExitCommands,
  writeEvalFile,
} from '../lib/shell.ts'
import { App } from './App.tsx'

export type StartView = 'dashboard' | 'worktree'

/** Information about the TUI state at exit time. */
export interface ExitInfo {
  activeWorktreeName: string
  worktreePath: string
  /** True if the user pressed 'o' to switch to a different worktree. */
  changed: boolean
}

/**
 * Launch the TUI interface.
 *
 * Returns when the user quits (q or Ctrl+C). The terminal is fully
 * restored before this function returns.
 *
 * @param startView - Which view to show initially
 * @param context - Worktree context from detectWorktree()
 * @param config - Port config for this repo
 */
export async function launchTui(
  startView: StartView,
  context: WorktreeInfo,
  config: PortConfig
): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C ourselves for clean exit
  })

  const root = createRoot(renderer)

  // Promise that resolves when the TUI wants to exit
  const { promise: exitPromise, resolve: requestExit } = Promise.withResolvers<ExitInfo>()

  root.render(
    <App startView={startView} context={context} config={config} requestExit={requestExit} />
  )

  // Wait for the user to quit
  const exitInfo = await exitPromise

  // Destroy renderer — restores terminal (leaves alternate screen, clears, restores cursor)
  renderer.destroy()

  // Now on normal terminal — handle shell integration and print message
  if (exitInfo.changed) {
    const evalCtx = getEvalContext()
    if (evalCtx) {
      if (exitInfo.worktreePath === context.repoRoot) {
        writeEvalFile(buildExitCommands(evalCtx.shell, context.repoRoot), evalCtx.evalFile)
      } else {
        writeEvalFile(
          buildEnterCommands(
            evalCtx.shell,
            exitInfo.worktreePath,
            exitInfo.activeWorktreeName,
            context.repoRoot
          ),
          evalCtx.evalFile
        )
      }
    }
    console.log(`Entered ${exitInfo.activeWorktreeName}`)
  }
}

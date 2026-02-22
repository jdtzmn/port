import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import type { WorktreeInfo, PortConfig } from '../types.ts'
import { App } from './App.tsx'

export type StartView = 'dashboard' | 'worktree'

/**
 * Launch the TUI interface.
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
    exitOnCtrlC: true,
  })

  const root = createRoot(renderer)
  root.render(<App startView={startView} context={context} config={config} />)
}

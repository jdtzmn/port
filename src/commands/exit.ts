import { detectWorktree } from '../lib/worktree.ts'
import * as output from '../lib/output.ts'
import { buildExitCommands, getEvalContext, writeEvalFile } from '../lib/shell.ts'

/**
 * Exit a port worktree and return to the repository root.
 *
 * When the shell hook is active (__PORT_EVAL env var), writes shell commands
 * (cd, unset) to the eval file for the hook to pick up.
 * Otherwise, prints a human-readable cd command and hint about shell integration.
 */
export async function exit(): Promise<void> {
  let repoRoot: string
  let isMainRepo: boolean
  try {
    const info = detectWorktree()
    repoRoot = info.repoRoot
    isMainRepo = info.isMainRepo
  } catch {
    output.error('Not in a git repository')
    process.exit(1)
  }

  // Check if we're in a worktree (via env var or git detection)
  const inWorktree = !!process.env.PORT_WORKTREE || !isMainRepo

  if (!inWorktree) {
    output.info('Already at the repository root')
    return
  }

  // If running inside the shell hook, write eval commands to the sideband file
  const evalCtx = getEvalContext()
  if (evalCtx) {
    const commands = buildExitCommands(evalCtx.shell, repoRoot)
    writeEvalFile(commands, evalCtx.evalFile)
    return
  }

  // Without shell integration — print human-readable output with hint
  output.info(`Run: cd ${repoRoot}`)
  output.newline()
  output.dim('Tip: Add shell integration so "port exit" works automatically:')
  output.dim('  eval "$(port shell-hook bash)"   # in ~/.bashrc')
  output.dim('  eval "$(port shell-hook zsh)"    # in ~/.zshrc')
  output.dim('  port shell-hook fish | source    # in ~/.config/fish/config.fish')
}

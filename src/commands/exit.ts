import { detectWorktree } from '../lib/worktree.ts'
import * as output from '../lib/output.ts'
import { buildExitCommands } from '../lib/shell.ts'

interface ExitOptions {
  shellHelper?: boolean
}

/**
 * Exit a port worktree and return to the repository root.
 *
 * With --shell-helper: outputs shell commands to stdout (cd, unset) for eval by the shell wrapper.
 * Without --shell-helper: prints a human-readable cd command and hint about shell integration.
 */
export async function exit(options?: ExitOptions): Promise<void> {
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

  // If --shell-helper mode, output shell commands to stdout for eval
  if (options?.shellHelper) {
    const commands = buildExitCommands('bash', repoRoot)
    process.stdout.write(commands + '\n')
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

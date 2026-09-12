/**
 * Command policy needed before Commander parses argv.
 *
 * This stays separate from command metadata so the CLI entry point can load
 * without creating a cycle through the Commander program.
 */
export const NON_WORKTREE_COMMANDS = new Set([
  'help',
  'completion',
  'init',
  'install',
  'cleanup',
  'prune',
  'uninstall',
  'onboard',
  'shell-hook',
  'doctor',
])

const SKIP_EARLY_WORK_COMMANDS = new Set(['enter', 'completion', 'shell-hook', 'doctor', 'list'])

export function shouldSkipEarlyWork(commandName: string | undefined): boolean {
  return commandName != null && SKIP_EARLY_WORK_COMMANDS.has(commandName)
}

export function shouldAutoRegisterWorktree(commandName: string | undefined): boolean {
  if (commandName?.startsWith('-')) {
    return false
  }

  if (!commandName) {
    return true
  }

  if (shouldSkipEarlyWork(commandName)) {
    return false
  }

  return !NON_WORKTREE_COMMANDS.has(commandName)
}

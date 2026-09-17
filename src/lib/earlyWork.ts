/**
 * Command policy needed before Commander parses argv.
 *
 * This stays separate from command metadata so the CLI entry point can load
 * without creating a cycle through the Commander program.
 */
export type CommandExecutionClass = 'query' | 'mutating' | 'interactive'

interface CommandPolicy {
  executionClass: CommandExecutionClass
  autoRegister?: boolean
  skipEarlyWork?: boolean
}

const QUERY_COMMAND: CommandPolicy = { executionClass: 'query' }
const EARLY_WORK_SKIP_QUERY_COMMAND: CommandPolicy = {
  executionClass: 'query',
  skipEarlyWork: true,
}
const MUTATING_GLOBAL_COMMAND: CommandPolicy = { executionClass: 'mutating', autoRegister: false }
const INTERACTIVE_COMMAND: CommandPolicy = { executionClass: 'interactive', skipEarlyWork: true }
const MUTATING_WORKTREE_COMMAND: CommandPolicy = { executionClass: 'mutating' }

/**
 * Policies for named commands whose behavior is known before Commander loads.
 * Unknown tokens are treated as interactive branch entry, the safe default.
 */
const COMMAND_POLICIES: Readonly<Record<string, CommandPolicy>> = {
  help: QUERY_COMMAND,
  list: EARLY_WORK_SKIP_QUERY_COMMAND,
  ls: EARLY_WORK_SKIP_QUERY_COMMAND,
  status: QUERY_COMMAND,
  doctor: EARLY_WORK_SKIP_QUERY_COMMAND,
  exit: QUERY_COMMAND,
  'shell-hook': EARLY_WORK_SKIP_QUERY_COMMAND,
  urls: QUERY_COMMAND,
  completion: EARLY_WORK_SKIP_QUERY_COMMAND,
  onboard: QUERY_COMMAND,

  init: MUTATING_GLOBAL_COMMAND,
  install: MUTATING_GLOBAL_COMMAND,
  cleanup: MUTATING_GLOBAL_COMMAND,
  prune: MUTATING_GLOBAL_COMMAND,
  uninstall: MUTATING_GLOBAL_COMMAND,

  up: MUTATING_WORKTREE_COMMAND,
  down: MUTATING_WORKTREE_COMMAND,
  remove: MUTATING_WORKTREE_COMMAND,
  rm: MUTATING_WORKTREE_COMMAND,
  compose: MUTATING_WORKTREE_COMMAND,
  dc: MUTATING_WORKTREE_COMMAND,
  run: MUTATING_WORKTREE_COMMAND,
  kill: MUTATING_WORKTREE_COMMAND,
  hook: MUTATING_WORKTREE_COMMAND,
  open: MUTATING_WORKTREE_COMMAND,
  rename: MUTATING_WORKTREE_COMMAND,
  mv: MUTATING_WORKTREE_COMMAND,
  enter: INTERACTIVE_COMMAND,
}

export function getCommandExecutionClass(commandName: string | undefined): CommandExecutionClass {
  return COMMAND_POLICIES[commandName ?? '']?.executionClass ?? 'interactive'
}

export function shouldSkipEarlyWork(commandName: string | undefined): boolean {
  return COMMAND_POLICIES[commandName ?? '']?.skipEarlyWork ?? false
}

export function shouldAutoRegisterWorktree(commandName: string | undefined): boolean {
  if (commandName?.startsWith('-')) {
    return false
  }

  if (!commandName) {
    return true
  }

  const policy = COMMAND_POLICIES[commandName]
  if (policy?.executionClass === 'query' || policy?.skipEarlyWork) {
    return false
  }

  return policy?.autoRegister ?? true
}

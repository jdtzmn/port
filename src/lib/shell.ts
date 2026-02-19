export type Shell = 'bash' | 'zsh' | 'fish'

export const SUPPORTED_SHELLS: Shell[] = ['bash', 'zsh', 'fish']

/**
 * Escape a string for safe use inside single quotes in bash/zsh.
 * Handles embedded single quotes by ending the quote, adding an escaped quote, and reopening.
 * e.g. "it's" → 'it'\''s'
 */
export function posixShellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/**
 * Escape a string for safe use inside single quotes in fish shell.
 * Fish uses backslash escaping inside single quotes for \\ and \'.
 */
export function fishShellQuote(value: string): string {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

/**
 * Quote a value for the given shell.
 */
export function shellQuote(shell: Shell, value: string): string {
  if (shell === 'fish') {
    return fishShellQuote(value)
  }
  return posixShellQuote(value)
}

/**
 * Generate a cd command for the given shell and path.
 */
export function shellCd(shell: Shell, path: string): string {
  const quoted = shellQuote(shell, path)
  if (shell === 'fish') {
    return `builtin cd ${quoted}`
  }
  // Use cd -- to handle paths starting with -
  return `cd -- ${quoted}`
}

/**
 * Generate an export command for the given shell.
 */
export function shellExport(shell: Shell, name: string, value: string): string {
  const quoted = shellQuote(shell, value)
  if (shell === 'fish') {
    return `set -gx ${name} ${quoted}`
  }
  return `export ${name}=${quoted}`
}

/**
 * Generate an unset command for the given shell.
 */
export function shellUnset(shell: Shell, name: string): string {
  if (shell === 'fish') {
    return `set -e ${name}`
  }
  return `unset ${name}`
}

/**
 * Build the complete set of shell commands for entering a worktree.
 */
export function buildEnterCommands(
  shell: Shell,
  worktreePath: string,
  branchName: string,
  repoRoot: string
): string {
  return [
    shellCd(shell, worktreePath),
    shellExport(shell, 'PORT_WORKTREE', branchName),
    shellExport(shell, 'PORT_REPO', repoRoot),
  ].join('\n')
}

/**
 * Build the complete set of shell commands for exiting a worktree.
 */
export function buildExitCommands(shell: Shell, repoRoot: string): string {
  return [
    shellCd(shell, repoRoot),
    shellUnset(shell, 'PORT_WORKTREE'),
    shellUnset(shell, 'PORT_REPO'),
  ].join('\n')
}

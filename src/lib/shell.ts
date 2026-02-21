import { writeFileSync } from 'fs'

export type Shell = 'bash' | 'zsh' | 'fish'

export const SUPPORTED_SHELLS: Shell[] = ['bash', 'zsh', 'fish']

/**
 * Environment variables used by the shell-hook sideband mechanism.
 *
 * __PORT_EVAL  – path to a temp file where shell commands should be written
 * __PORT_SHELL – the shell type (bash, zsh, fish) for proper quoting
 *
 * Both are set by the shell-hook wrapper function and read by the binary.
 * The trust boundary is the same as the port binary itself: if an attacker
 * can set your environment variables, they already have your privileges.
 */
export interface EvalContext {
  shell: Shell
  evalFile: string
}

/**
 * Check if the shell-hook eval mechanism is active.
 * Returns the shell type and eval file path, or null if not running inside the hook.
 */
export function getEvalContext(): EvalContext | null {
  const evalFile = process.env.__PORT_EVAL
  const shell = process.env.__PORT_SHELL as Shell | undefined
  if (!evalFile || !shell || !SUPPORTED_SHELLS.includes(shell)) return null
  return { shell, evalFile }
}

/**
 * Write shell commands to the eval file for the shell hook to pick up.
 * The hook reads this file after the binary exits and evals its contents.
 */
export function writeEvalFile(commands: string, evalFile: string): void {
  writeFileSync(evalFile, commands + '\n')
}

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

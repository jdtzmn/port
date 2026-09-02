/**
 * Shell profile management for the `port` shell hook.
 *
 * `port install` uses this module to add (and `port uninstall` to remove) a
 * managed block in the user's shell profile that evaluates `port shell-hook`.
 * The block is delimited by markers so it can be rewritten or removed without
 * disturbing anything else in the profile.
 */

import { homedir } from 'os'
import { dirname, join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { SUPPORTED_SHELLS, type Shell } from './shell.ts'

export const BLOCK_START = '# >>> port shell hook >>>'
export const BLOCK_END = '# <<< port shell hook <<<'

/**
 * Detect the user's login shell from $SHELL.
 * Returns null when the shell is unset or unsupported.
 */
export function detectShell(shellPath = process.env.SHELL): Shell | null {
  if (!shellPath) return null
  const name = shellPath.split('/').pop() ?? ''
  return SUPPORTED_SHELLS.includes(name as Shell) ? (name as Shell) : null
}

/**
 * Path of the profile file sourced by interactive shells.
 */
export function getProfilePath(shell: Shell, home = homedir()): string {
  switch (shell) {
    case 'bash':
      return join(home, '.bashrc')
    case 'zsh':
      return join(home, '.zshrc')
    case 'fish':
      return join(home, '.config', 'fish', 'config.fish')
  }
}

/**
 * The managed block written into the profile.
 *
 * The `port` binary may not be on PATH in every shell (for example after the
 * package is removed), so the hook is guarded by a lookup to keep the profile
 * from erroring at startup.
 */
export function buildProfileBlock(shell: Shell): string {
  const body =
    shell === 'fish'
      ? ['if command -q port', '  port shell-hook fish | source', 'end']
      : [`if command -v port >/dev/null 2>&1; then`, `  eval "$(port shell-hook ${shell})"`, `fi`]

  return [BLOCK_START, ...body, BLOCK_END].join('\n')
}

/** Whether the profile content already contains the managed block. */
export function hasManagedBlock(content: string): boolean {
  return content.includes(BLOCK_START)
}

/**
 * Whether the profile already sets up the hook by hand (outside the managed
 * block), in which case install leaves the profile alone.
 */
export function hasManualHook(content: string): boolean {
  return !hasManagedBlock(content) && content.includes('port shell-hook')
}

/** Append the managed block to profile content. */
export function withManagedBlock(content: string, block: string): string {
  const base = content.length === 0 || content.endsWith('\n') ? content : content + '\n'
  const separator = base.length === 0 ? '' : '\n'
  return base + separator + block + '\n'
}

/** Remove the managed block (and the blank line before it) from profile content. */
export function withoutManagedBlock(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let inBlock = false

  for (const line of lines) {
    if (line.trim() === BLOCK_START) {
      inBlock = true
      // Drop only the single blank line withManagedBlock inserted as a separator
      if (result.length > 0 && result[result.length - 1]?.trim() === '') result.pop()
      continue
    }
    if (inBlock) {
      if (line.trim() === BLOCK_END) inBlock = false
      continue
    }
    result.push(line)
  }

  return result.join('\n')
}

async function readProfile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

export type ShellHookInstallResult =
  | { status: 'installed'; shell: Shell; profilePath: string }
  | { status: 'already-installed'; shell: Shell; profilePath: string }
  | { status: 'manual-hook'; shell: Shell; profilePath: string }
  | { status: 'unsupported-shell'; shellPath: string | undefined }

/**
 * Add the managed shell hook block to the profile of the given shell.
 */
export async function installShellHook(shell: Shell): Promise<ShellHookInstallResult> {
  const profilePath = getProfilePath(shell)
  const content = await readProfile(profilePath)

  if (hasManagedBlock(content)) {
    return { status: 'already-installed', shell, profilePath }
  }

  if (hasManualHook(content)) {
    return { status: 'manual-hook', shell, profilePath }
  }

  await mkdir(dirname(profilePath), { recursive: true })
  await writeFile(profilePath, withManagedBlock(content, buildProfileBlock(shell)))

  return { status: 'installed', shell, profilePath }
}

export type ShellHookRemovalResult =
  | { status: 'removed'; shell: Shell; profilePath: string }
  | { status: 'not-installed'; shell: Shell; profilePath: string }

/**
 * Remove the managed shell hook block from the profile of the given shell.
 */
export async function removeShellHook(shell: Shell): Promise<ShellHookRemovalResult> {
  const profilePath = getProfilePath(shell)
  const content = await readProfile(profilePath)

  if (!hasManagedBlock(content)) {
    return { status: 'not-installed', shell, profilePath }
  }

  await writeFile(profilePath, withoutManagedBlock(content))

  return { status: 'removed', shell, profilePath }
}

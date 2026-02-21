/**
 * CLI command metadata introspection.
 *
 * Provides a centralized API for extracting command names, aliases,
 * descriptions, options, and argument types from the Commander.js
 * program object. Used by completion script generation, typo detection,
 * and command-branch collision warnings.
 *
 * All functions introspect `program.commands` at call time so the data
 * is always consistent with what is registered in `src/index.ts`.
 */

import { distance as levenshteinDistance } from 'fastest-levenshtein'
import { program } from '../index.ts'

// ---------------------------------------------------------------------------
// Core introspection
// ---------------------------------------------------------------------------

/**
 * All subcommand names and aliases, including the implicit `help` command.
 */
export function getSubcommands(): string[] {
  const names = new Set<string>(['help'])

  for (const command of program.commands) {
    names.add(command.name())

    for (const alias of command.aliases()) {
      names.add(alias)
    }
  }

  return [...names]
}

/**
 * Commands that accept a `<branch>` argument (detected by argument name).
 * Returns both primary names and aliases.
 */
export function getBranchCommands(): string[] {
  const result: string[] = []

  for (const command of program.commands) {
    const hasBranchArg = command.registeredArguments.some(arg => arg.name() === 'branch')
    if (hasBranchArg) {
      result.push(command.name())
      result.push(...command.aliases())
    }
  }

  return result
}

/**
 * Commands that accept a `<shell>` argument (detected by argument name).
 */
export function getShellCommands(): string[] {
  const result: string[] = []

  for (const command of program.commands) {
    const hasShellArg = command.registeredArguments.some(arg => arg.name() === 'shell')
    if (hasShellArg) {
      result.push(command.name())
      result.push(...command.aliases())
    }
  }

  return result
}

/**
 * Per-command flags, keyed by command name and alias.
 * Only includes commands that have options beyond the global defaults.
 * Excludes hidden options.
 */
export function getCommandFlags(): Record<string, string[]> {
  const result: Record<string, string[]> = {}

  for (const command of program.commands) {
    const flags: string[] = []

    for (const opt of command.options) {
      if (opt.hidden) continue
      if (opt.short) flags.push(opt.short)
      if (opt.long) flags.push(opt.long)
    }

    if (flags.length === 0) continue

    // Register under both the primary name and all aliases
    result[command.name()] = flags
    for (const alias of command.aliases()) {
      result[alias] = flags
    }
  }

  return result
}

/**
 * Global program-level flags (e.g. `--version`, `--help`).
 */
export function getGlobalFlags(): string[] {
  const flags: string[] = []

  for (const opt of program.options) {
    if (opt.hidden) continue
    if (opt.short) flags.push(opt.short)
    if (opt.long) flags.push(opt.long)
  }

  // Commander always registers -h/--help but doesn't expose it via
  // program.options — add it explicitly if missing.
  if (!flags.includes('-h')) flags.push('-h')
  if (!flags.includes('--help')) flags.push('--help')

  return flags
}

/**
 * Map of command name/alias → description.
 * Aliases share the description of their parent command.
 */
export function getCommandDescriptions(): Record<string, string> {
  const result: Record<string, string> = {}

  for (const command of program.commands) {
    const desc = command.description()
    result[command.name()] = desc

    for (const alias of command.aliases()) {
      result[alias] = desc
    }
  }

  result['help'] = 'Display help for command'

  return result
}

// ---------------------------------------------------------------------------
// Typo detection and command matching
// ---------------------------------------------------------------------------

export interface SimilarCommandMatch {
  command: string
  distance: number
  similarity: number
}

/**
 * Check if the value is a reserved top-level CLI command or alias.
 */
export function isReservedCommand(value: string): boolean {
  return getSubcommands().includes(value)
}

/**
 * Find a likely command typo when a branch name is close to an existing command.
 */
export function findSimilarCommand(value: string): SimilarCommandMatch | null {
  const normalizedValue = value.toLowerCase()

  let best: SimilarCommandMatch | null = null

  for (const command of getSubcommands()) {
    const dist = levenshteinDistance(normalizedValue, command)
    const maxLen = Math.max(normalizedValue.length, command.length)
    const similarity = maxLen === 0 ? 1 : 1 - dist / maxLen

    if (!isLikelyTypo(normalizedValue, command, dist, similarity)) {
      continue
    }

    if (!best || dist < best.distance || (dist === best.distance && similarity > best.similarity)) {
      best = {
        command,
        distance: dist,
        similarity,
      }
    }
  }

  return best
}

function isLikelyTypo(
  value: string,
  command: string,
  distance: number,
  similarity: number
): boolean {
  if (value === command) {
    return false
  }

  if (value.includes('/') || value.includes('-')) {
    return false
  }

  if (Math.min(value.length, command.length) < 4) {
    return distance <= 1
  }

  return distance <= 2 && similarity >= 0.6
}

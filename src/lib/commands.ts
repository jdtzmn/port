import { distance as levenshteinDistance } from 'fastest-levenshtein'
import { program } from '../index.ts'

function getReservedCommands(): readonly string[] {
  const reserved = new Set<string>(['help'])

  for (const command of program.commands) {
    reserved.add(command.name())

    for (const alias of command.aliases()) {
      reserved.add(alias)
    }
  }

  return [...reserved]
}

export interface SimilarCommandMatch {
  command: string
  distance: number
  similarity: number
}

/**
 * Check if the value is a reserved top-level CLI command or alias.
 */
export function isReservedCommand(value: string): boolean {
  return getReservedCommands().includes(value)
}

/**
 * Find a likely command typo when a branch name is close to an existing command.
 */
export function findSimilarCommand(value: string): SimilarCommandMatch | null {
  const normalizedValue = value.toLowerCase()

  let best: SimilarCommandMatch | null = null

  for (const command of getReservedCommands()) {
    const distance = levenshteinDistance(normalizedValue, command)
    const maxLen = Math.max(normalizedValue.length, command.length)
    const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen

    if (!isLikelyTypo(normalizedValue, command, distance, similarity)) {
      continue
    }

    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && similarity > best.similarity)
    ) {
      best = {
        command,
        distance,
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

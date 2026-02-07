import { describe, expect, test } from 'vitest'
import { findSimilarCommand, isReservedCommand } from './commands.ts'

describe('command name helpers', () => {
  test('recognizes reserved commands and aliases', () => {
    expect(isReservedCommand('install')).toBe(true)
    expect(isReservedCommand('ls')).toBe(true)
    expect(isReservedCommand('feature/install-docs')).toBe(false)
  })

  test('finds likely typos against known commands', () => {
    expect(findSimilarCommand('instal')).toMatchObject({ command: 'install', distance: 1 })
    expect(findSimilarCommand('staus')).toMatchObject({ command: 'status', distance: 1 })
  })

  test('finds likely typos against command aliases', () => {
    expect(findSimilarCommand('l')).toMatchObject({ command: 'ls', distance: 1 })
  })

  test('ignores exact commands and branch-like names', () => {
    expect(findSimilarCommand('cleanup')).toBeNull()
    expect(findSimilarCommand('feature/install-docs')).toBeNull()
  })
})

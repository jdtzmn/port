import { describe, expect, test } from 'vitest'
import { findHostnameLabelCollisions, formatHostnameLabel } from './hostname.ts'

describe('formatHostnameLabel', () => {
  test('truncates sanitized labels to the DNS label limit', () => {
    const label = formatHostnameLabel('feature-' + 'a'.repeat(80))

    expect(label.length).toBe(63)
    expect(label).toBe('feature-' + 'a'.repeat(55))
  })

  test('detects collisions among active labels that truncate to the same value', () => {
    const collisions = findHostnameLabelCollisions('repo-a', 'feature-' + 'a'.repeat(80), [
      { repo: 'repo-b', branch: 'feature-' + 'a'.repeat(79) + 'b' },
      { repo: 'repo-c', branch: 'feature-short' },
    ])

    expect(collisions).toEqual([{ repo: 'repo-b', branch: 'feature-' + 'a'.repeat(79) + 'b' }])
  })
})

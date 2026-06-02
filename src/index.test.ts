import { describe, test, expect } from 'vitest'
import { joinBranchArgs } from './index.ts'

describe('joinBranchArgs', () => {
  test('joins bare multi-word tokens with a single space', () => {
    expect(joinBranchArgs(['my', 'feature'])).toBe('my feature')
  })

  test('collapses extra tokens into single-spaced words', () => {
    expect(joinBranchArgs(['my', 'cool', 'feature'])).toBe('my cool feature')
  })

  test('preserves an already-quoted single argument containing spaces', () => {
    expect(joinBranchArgs(['my feature'])).toBe('my feature')
  })

  test('returns a single token unchanged', () => {
    expect(joinBranchArgs(['single'])).toBe('single')
  })

  test('returns undefined for an empty array', () => {
    expect(joinBranchArgs([])).toBeUndefined()
  })

  test('returns undefined for undefined input', () => {
    expect(joinBranchArgs(undefined)).toBeUndefined()
  })
})

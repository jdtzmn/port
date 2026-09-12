import { describe, expect, test } from 'vitest'
import { evaluateBudget, summarizeSamples, toBenchmarkEntry } from './benchmark.ts'

describe('summarizeSamples', () => {
  test('reports median, p95, and sample count from unsorted samples', () => {
    const summary = summarizeSamples([70, 10, 20, 30, 40, 50, 60, 80, 90, 100])

    expect(summary).toEqual({
      samples: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      sampleCount: 10,
      median: 55,
      p95: 95.5,
    })
  })

  test('rejects empty and invalid sample sets', () => {
    expect(() => summarizeSamples([])).toThrow('at least one sample')
    expect(() => summarizeSamples([1, Number.NaN])).toThrow('finite')
    expect(() => summarizeSamples([-1])).toThrow('non-negative')
  })
})

describe('evaluateBudget', () => {
  test('reports a passing p95 budget', () => {
    expect(evaluateBudget({ p95: 250 }, 249.9)).toEqual({ passed: true, limit: 250, value: 249.9 })
  })

  test('reports a failing p95 budget', () => {
    expect(evaluateBudget({ p95: 250 }, 250.1)).toEqual({ passed: false, limit: 250, value: 250.1 })
  })
})

describe('toBenchmarkEntry', () => {
  test('creates github-action-benchmark custom output from a summary', () => {
    const entry = toBenchmarkEntry('CLI responsiveness / help', {
      samples: [10, 20, 30],
      sampleCount: 3,
      median: 20,
      p95: 29,
    })

    expect(entry).toEqual({
      name: 'CLI responsiveness / help',
      unit: 'ms',
      value: 20,
      range: '9',
      extra: 'p95: 29 ms\nsamples: 3',
    })
  })
})

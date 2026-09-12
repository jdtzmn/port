export interface BenchmarkSummary {
  samples: number[]
  sampleCount: number
  median: number
  p95: number
}

export interface BenchmarkBudget {
  p95: number
}

export interface BudgetResult {
  passed: boolean
  limit: number
  value: number
}

export interface BenchmarkEntry {
  name: string
  unit: 'ms'
  value: number
  range: string
  extra: string
}

function percentile(sortedSamples: number[], percentileValue: number): number {
  const index = (sortedSamples.length - 1) * percentileValue
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lower = sortedSamples[lowerIndex]!
  const upper = sortedSamples[upperIndex]!

  return Math.round((lower + (upper - lower) * (index - lowerIndex)) * 1000) / 1000
}

export function summarizeSamples(samples: number[]): BenchmarkSummary {
  if (samples.length === 0) {
    throw new Error('Benchmark summaries require at least one sample')
  }

  if (!samples.every(Number.isFinite)) {
    throw new Error('Benchmark samples must be finite numbers')
  }

  if (!samples.every(sample => sample >= 0)) {
    throw new Error('Benchmark samples must be non-negative')
  }

  const sortedSamples = [...samples].sort((left, right) => left - right)

  return {
    samples: sortedSamples,
    sampleCount: sortedSamples.length,
    median: percentile(sortedSamples, 0.5),
    p95: percentile(sortedSamples, 0.95),
  }
}

export function evaluateBudget(budget: BenchmarkBudget, p95: number): BudgetResult {
  return {
    passed: p95 <= budget.p95,
    limit: budget.p95,
    value: p95,
  }
}

export function toBenchmarkEntry(name: string, summary: BenchmarkSummary): BenchmarkEntry {
  return {
    name,
    unit: 'ms',
    value: summary.median,
    range: `${summary.p95 - summary.median}`,
    extra: `p95: ${summary.p95} ms\nsamples: ${summary.sampleCount}`,
  }
}

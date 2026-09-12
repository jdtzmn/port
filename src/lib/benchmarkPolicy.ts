import type { BenchmarkBudget } from './benchmark.ts'

export type BenchmarkCategory = 'cli' | 'worktree' | 'docker'

export type BenchmarkId =
  | 'help'
  | 'list-small'
  | 'list-large'
  | 'enter-existing-small'
  | 'enter-existing-large'
  | 'enter-new-small'
  | 'enter-new-large'
  | 'status-small'
  | 'status-large'
  | 'up-warm'

export interface BenchmarkDefinition {
  id: BenchmarkId
  category: BenchmarkCategory
  name: string
  budget: BenchmarkBudget
  requiresDocker?: boolean
}

export const BENCHMARK_DEFINITIONS: Record<BenchmarkId, BenchmarkDefinition> = {
  help: {
    id: 'help',
    category: 'cli',
    name: 'CLI responsiveness / help',
    budget: { p95: 500 },
  },
  'list-small': {
    id: 'list-small',
    category: 'cli',
    name: 'CLI responsiveness / list (small)',
    budget: { p95: 1500 },
  },
  'list-large': {
    id: 'list-large',
    category: 'cli',
    name: 'CLI responsiveness / list (large)',
    budget: { p95: 1500 },
  },
  'enter-existing-small': {
    id: 'enter-existing-small',
    category: 'worktree',
    name: 'Worktree operations / enter existing (small)',
    budget: { p95: 1500 },
  },
  'enter-existing-large': {
    id: 'enter-existing-large',
    category: 'worktree',
    name: 'Worktree operations / enter existing (large)',
    budget: { p95: 1500 },
  },
  'enter-new-small': {
    id: 'enter-new-small',
    category: 'worktree',
    name: 'Worktree operations / enter new (small)',
    budget: { p95: 4000 },
  },
  'enter-new-large': {
    id: 'enter-new-large',
    category: 'worktree',
    name: 'Worktree operations / enter new (large)',
    budget: { p95: 4000 },
  },
  'status-small': {
    id: 'status-small',
    category: 'docker',
    name: 'Docker operations / status (small)',
    budget: { p95: 1000 },
    requiresDocker: true,
  },
  'status-large': {
    id: 'status-large',
    category: 'docker',
    name: 'Docker operations / status (large)',
    budget: { p95: 2000 },
    requiresDocker: true,
  },
  'up-warm': {
    id: 'up-warm',
    category: 'docker',
    name: 'Docker operations / up (warm)',
    budget: { p95: 5000 },
    requiresDocker: true,
  },
}

export const BENCHMARKS = Object.values(BENCHMARK_DEFINITIONS)

export interface RemoteE2ESuite {
  file: string
  estimatedDurationMs: number
}

export interface RemoteE2EShardBudget {
  setupDurationMs: number
  targetDurationMs: number
  maxShards: number
}

export const REMOTE_E2E_SUITES = [
  { file: 'owners.remote-e2e.test.ts', estimatedDurationMs: 60_000 },
  { file: 'automatic-a.remote-e2e.test.ts', estimatedDurationMs: 35_000 },
  { file: 'automatic-b.remote-e2e.test.ts', estimatedDurationMs: 35_000 },
  { file: 'foundation.remote-e2e.test.ts', estimatedDurationMs: 15_000 },
  { file: 'transport.remote-e2e.test.ts', estimatedDurationMs: 10_000 },
  { file: 'missing-port.remote-e2e.test.ts', estimatedDurationMs: 2_000 },
] as const satisfies readonly RemoteE2ESuite[]

export const REMOTE_E2E_SHARD_BUDGET = {
  setupDurationMs: 100_000,
  targetDurationMs: 165_000,
  maxShards: 4,
} as const satisfies RemoteE2EShardBudget

const REMOTE_E2E_EXECUTION_ORDER = new Map<string, number>([
  ['transport.remote-e2e.test.ts', 0],
  ['foundation.remote-e2e.test.ts', 1],
  ['automatic-a.remote-e2e.test.ts', 2],
  ['automatic-b.remote-e2e.test.ts', 2],
  ['owners.remote-e2e.test.ts', 3],
  ['missing-port.remote-e2e.test.ts', 4],
])

export function sortRemoteE2ESuiteFiles(files: readonly string[]): string[] {
  return [...files].sort(
    (left, right) =>
      (REMOTE_E2E_EXECUTION_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (REMOTE_E2E_EXECUTION_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right)
  )
}

export function recommendedRemoteE2EShardCount(
  suites: readonly RemoteE2ESuite[],
  budget: RemoteE2EShardBudget
): number {
  if (suites.length === 0) return 1

  const scenarioBudgetMs = Math.max(1, budget.targetDurationMs - budget.setupDurationMs)
  const totalDurationMs = suites.reduce((total, suite) => total + suite.estimatedDurationMs, 0)
  const calculated = Math.ceil(totalDurationMs / scenarioBudgetMs)

  return Math.max(1, Math.min(calculated, budget.maxShards, suites.length))
}

export function planRemoteE2EShards(
  suites: readonly RemoteE2ESuite[],
  shardCount: number
): string[][] {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer; received ${shardCount}`)
  }

  const bins = Array.from({ length: shardCount }, () => ({ durationMs: 0, files: [] as string[] }))
  const longestFirst = [...suites].sort(
    (left, right) =>
      right.estimatedDurationMs - left.estimatedDurationMs || left.file.localeCompare(right.file)
  )

  for (const suite of longestFirst) {
    const lightest = bins.reduce((best, bin) => (bin.durationMs < best.durationMs ? bin : best))
    lightest.files.push(suite.file)
    lightest.durationMs += suite.estimatedDurationMs
  }

  return bins.map(bin => bin.files)
}

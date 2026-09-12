import { describe, expect, test } from 'vitest'
import { planRemoteE2EShards, recommendedRemoteE2EShardCount } from './sharding'

const suites = [
  { file: 'owners.test.ts', estimatedDurationMs: 60_000 },
  { file: 'automatic-a.test.ts', estimatedDurationMs: 35_000 },
  { file: 'automatic-b.test.ts', estimatedDurationMs: 35_000 },
  { file: 'foundation.test.ts', estimatedDurationMs: 15_000 },
  { file: 'transport.test.ts', estimatedDurationMs: 10_000 },
  { file: 'missing.test.ts', estimatedDurationMs: 2_000 },
]

describe('remote E2E shard planning', () => {
  test('scales shard count from the target critical-path budget', () => {
    expect(
      recommendedRemoteE2EShardCount(suites, {
        setupDurationMs: 100_000,
        targetDurationMs: 165_000,
        maxShards: 4,
      })
    ).toBe(3)
  })

  test('caps the shard count at both maxShards and suite count', () => {
    expect(
      recommendedRemoteE2EShardCount(suites.slice(0, 2), {
        setupDurationMs: 160_000,
        targetDurationMs: 165_000,
        maxShards: 4,
      })
    ).toBe(2)
  })

  test('balances longest suites first instead of hashing filenames', () => {
    expect(planRemoteE2EShards(suites, 3)).toEqual([
      ['owners.test.ts'],
      ['automatic-a.test.ts', 'foundation.test.ts'],
      ['automatic-b.test.ts', 'transport.test.ts', 'missing.test.ts'],
    ])
  })
})

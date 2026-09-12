import {
  planRemoteE2EShards,
  recommendedRemoteE2EShardCount,
  REMOTE_E2E_SHARD_BUDGET,
  REMOTE_E2E_SUITES,
} from './sharding'

const shardCount = recommendedRemoteE2EShardCount(REMOTE_E2E_SUITES, REMOTE_E2E_SHARD_BUDGET)
const plans = planRemoteE2EShards(REMOTE_E2E_SUITES, shardCount)
const durationByFile = new Map<string, number>(
  REMOTE_E2E_SUITES.map(suite => [suite.file, suite.estimatedDurationMs])
)

const include = plans.map((files, index) => ({
  index: index + 1,
  count: shardCount,
  estimatedScenarioMs: files.reduce((total, file) => total + (durationByFile.get(file) ?? 0), 0),
}))

process.stdout.write(JSON.stringify({ include }))

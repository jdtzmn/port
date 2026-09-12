import { basename } from 'node:path'
import { BaseSequencer, type TestSpecification } from 'vitest/node'
import { planRemoteE2EShards, REMOTE_E2E_SUITES, sortRemoteE2ESuiteFiles } from './sharding'

const durationByFile = new Map<string, number>(
  REMOTE_E2E_SUITES.map(suite => [suite.file, suite.estimatedDurationMs])
)

export default class RemoteE2ESequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard
    if (!shard) return files
    const suites = files.map(file => {
      const name = basename(file.moduleId)
      const estimatedDurationMs = durationByFile.get(name)
      if (estimatedDurationMs === undefined) {
        throw new Error(`Remote E2E suite ${name} is missing from REMOTE_E2E_SUITES`)
      }
      return { file: name, estimatedDurationMs }
    })
    const selected = new Set(planRemoteE2EShards(suites, shard.count)[shard.index - 1] ?? [])

    return files.filter(file => selected.has(basename(file.moduleId)))
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const byName = new Map(files.map(file => [basename(file.moduleId), file]))
    return sortRemoteE2ESuiteFiles([...byName.keys()]).map(file => {
      const specification = byName.get(file)
      if (!specification) throw new Error(`Missing remote E2E specification for ${file}`)
      return specification
    })
  }
}

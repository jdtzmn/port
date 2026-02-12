import { describe, expect, test } from 'vitest'
import { prepareSample } from './utils'
import { cleanupTaskRuntime, runPortCommand, writePortConfig } from './taskIntegrationHelpers'

const INTEGRATION_TIMEOUT = 60000

describe('task remote integration', () => {
  test(
    'remote status falls back to local for unknown configured adapter',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await writePortConfig(sample.dir, {
          domain: 'port',
          compose: 'docker-compose.yml',
          task: { daemonIdleStopMinutes: 10 },
          remote: { adapter: 'unknown-adapter' },
        })

        const status = await runPortCommand(['remote', 'status'], sample.dir)
        expect(status.stdout).toContain('Configured adapter: unknown-adapter')
        expect(status.stdout).toContain('Resolved adapter: local')
        expect(status.stdout).toContain('Fallback used: yes')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'remote doctor warns when using stub-remote adapter',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await writePortConfig(sample.dir, {
          domain: 'port',
          compose: 'docker-compose.yml',
          task: { daemonIdleStopMinutes: 10 },
          remote: { adapter: 'stub-remote' },
        })

        const doctor = await runPortCommand(['remote', 'doctor'], sample.dir)
        expect(doctor.stderr).toContain('stub-remote is a contract stub')
        expect(doctor.stdout).toContain('Remote configuration looks healthy')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )
})

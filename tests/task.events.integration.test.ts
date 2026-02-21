import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, test } from 'vitest'
import { prepareSample } from './utils'
import {
  cleanupTaskRuntime,
  getTaskById,
  runPortCommand,
  waitFor,
  waitForTaskByTitle,
  waitForTaskStatus,
  writePortConfig,
} from './taskIntegrationHelpers'

const INTEGRATION_TIMEOUT = 60000

describe('task event stream integration', () => {
  test(
    'global task events include lifecycle entries',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'events-global'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'events-global')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '30'], sample.dir)

        const events = await runPortCommand(['task', 'events'], sample.dir)
        expect(events.stdout).toContain(task.id)
        expect(events.stdout).toContain('task.created')
        expect(events.stdout).toContain('task.completed')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'consumer cursor replays events only once',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'events-consumer'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'events-consumer')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '30'], sample.dir)

        const firstRead = await runPortCommand(
          ['task', 'events', '--consumer', 'qa-client'],
          sample.dir
        )
        const secondRead = await runPortCommand(
          ['task', 'events', '--consumer', 'qa-client'],
          sample.dir
        )

        expect(firstRead.stdout).toContain(task.id)
        expect(secondRead.stdout.trim()).toBe('')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'opencode subscriber writes notifications when subscriptions are enabled',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await writePortConfig(sample.dir, {
          domain: 'port',
          compose: 'docker-compose.yml',
          task: {
            daemonIdleStopMinutes: 10,
            subscriptions: {
              enabled: true,
              consumers: ['opencode'],
            },
          },
          remote: {
            adapter: 'local',
          },
        })

        await runPortCommand(['task', 'start', 'events-opencode'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'events-opencode')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '30'], sample.dir)

        const outbox = join(
          sample.dir,
          '.port',
          'jobs',
          'subscribers',
          'opencode.notifications.log'
        )
        expect(existsSync(outbox)).toBe(true)

        const contents = await readFile(outbox, 'utf-8')
        expect(contents).toContain('<task-notification')
        expect(contents).toContain(task.id)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'consumer cursor receives checkpoint and revive lifecycle events once',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(
          ['task', 'start', 'events-revive[sleep=5000]', '--branch', 'feat-events'],
          sample.dir
        )
        const task = await waitForTaskByTitle(sample.dir, 'events-revive[sleep=5000]')

        await waitFor(
          'task has active worker checkpoint',
          async () => getTaskById(sample.dir, task.id),
          value => Boolean(value.runtime?.workerPid && value.runtime?.checkpoint),
          { timeoutMs: 20000 }
        )

        const initialRead = await runPortCommand(
          ['task', 'events', '--consumer', 'lifecycle-subscriber'],
          sample.dir
        )
        expect(initialRead.stdout).toContain(task.id)

        const crashed = await getTaskById(sample.dir, task.id)
        if (!crashed?.runtime?.workerPid) {
          throw new Error('Expected worker PID to be available for crash simulation')
        }
        process.kill(crashed.runtime.workerPid, 'SIGKILL')

        await runPortCommand(['task', 'attach', task.id], sample.dir)
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '60'], sample.dir)
        await waitForTaskStatus(sample.dir, task.id, ['completed', 'failed', 'timeout'])

        const replayRead = await runPortCommand(
          ['task', 'events', '--consumer', 'lifecycle-subscriber'],
          sample.dir
        )

        expect(replayRead.stdout).toContain('task.attach.revive_started')
        expect(replayRead.stdout).toContain('task.attach.revive_succeeded')
        expect(replayRead.stdout).toContain('task.checkpoint.updated')

        const emptyRead = await runPortCommand(
          ['task', 'events', '--consumer', 'lifecycle-subscriber'],
          sample.dir
        )
        expect(emptyRead.stdout.trim()).toBe('')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )
})

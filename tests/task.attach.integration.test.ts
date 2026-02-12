import { describe, expect, test } from 'vitest'
import { prepareSample } from './utils'
import {
  cleanupTaskRuntime,
  getTaskById,
  runPortCommand,
  waitFor,
  waitForTaskByTitle,
  waitForTaskStatus,
} from './taskIntegrationHelpers'

const INTEGRATION_TIMEOUT = 70000

describe('task attach integration', () => {
  test(
    'attach revives terminal task into a continuation run',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'attach-terminal'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'attach-terminal')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '40'], sample.dir)

        const beforeAttach = await getTaskById(sample.dir, task.id)
        const baselineAttempt = beforeAttach?.runtime?.runAttempt ?? 1

        const attach = await runPortCommand(['task', 'attach', task.id], sample.dir)
        expect(attach.stdout).toContain('Revived')

        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '60'], sample.dir)
        const afterAttach = await waitForTaskStatus(sample.dir, task.id, [
          'completed',
          'failed',
          'timeout',
        ])

        expect(afterAttach.runtime?.runAttempt ?? 0).toBeGreaterThanOrEqual(baselineAttempt + 1)

        const events = await runPortCommand(['task', 'events'], sample.dir)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_started`)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_succeeded`)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'attach revives a dead non-terminal task after worker crash',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(
          ['task', 'start', 'attach-dead[sleep=6000]', '--branch', 'feat-attach'],
          sample.dir
        )
        const task = await waitForTaskByTitle(sample.dir, 'attach-dead[sleep=6000]')

        const running = await waitFor(
          'task has checkpoint and worker pid',
          async () => getTaskById(sample.dir, task.id),
          value => Boolean(value.runtime?.workerPid && value.runtime?.checkpoint),
          { timeoutMs: 20000 }
        )

        process.kill(running.runtime!.workerPid!, 'SIGKILL')

        const attach = await runPortCommand(['task', 'attach', task.id], sample.dir)
        expect(attach.stdout).toContain('Revived')

        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '60'], sample.dir)
        const finalTask = await waitForTaskStatus(sample.dir, task.id, [
          'completed',
          'failed',
          'timeout',
        ])
        expect(finalTask.status).toBe('completed')
        expect((finalTask.runtime?.runAttempt ?? 0) >= 2).toBe(true)

        const events = await runPortCommand(['task', 'events'], sample.dir)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_started`)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_succeeded`)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )
})

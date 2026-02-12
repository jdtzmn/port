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

describe('task resume integration', () => {
  test(
    'resume is no-op for terminal tasks with guidance',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'resume-terminal'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'resume-terminal')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '30'], sample.dir)

        const resume = await runPortCommand(['task', 'resume', task.id], sample.dir)
        expect(resume.stdout).toContain('use attach to revive it')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'restores a non-terminal task from checkpoint after worker crash',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(
          ['task', 'start', 'resume-worker[sleep=5000]', '--branch', 'feat-resume'],
          sample.dir
        )
        const task = await waitForTaskByTitle(sample.dir, 'resume-worker[sleep=5000]')

        const running = await waitFor(
          'task has worker pid and checkpoint',
          async () => getTaskById(sample.dir, task.id),
          value => Boolean(value.runtime?.workerPid && value.runtime?.checkpoint),
          { timeoutMs: 20000 }
        )

        process.kill(running.runtime!.workerPid!, 'SIGKILL')

        await runPortCommand(['task', 'resume', task.id], sample.dir)
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '60'], sample.dir)

        const finalTask = await waitForTaskStatus(sample.dir, task.id, [
          'completed',
          'failed',
          'timeout',
        ])
        const finalizedRun = await waitFor(
          'completed task run finalized',
          async () => getTaskById(sample.dir, task.id),
          value => value.status !== 'completed' || value.runtime?.activeRunId === undefined,
          { timeoutMs: 10000 }
        )
        expect(finalTask.status).toBe('completed')
        expect((finalizedRun.runtime?.runAttempt ?? 0) >= 2).toBe(true)
        expect((finalizedRun.runtime?.checkpointHistory?.length ?? 0) >= 1).toBe(true)
        expect((finalizedRun.runtime?.runs?.length ?? 0) >= 2).toBe(true)
        expect(finalizedRun.runtime?.activeRunId).toBeUndefined()

        const events = await runPortCommand(['task', 'events'], sample.dir)
        expect(events.stdout).toContain('task.run.continuation_started')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )
})

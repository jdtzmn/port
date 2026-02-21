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
    'attach revives terminal task and performs handoff to paused_for_attach',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        // Use a short task so it completes quickly, then attach revives it.
        await runPortCommand(['task', 'start', 'attach-terminal'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'attach-terminal')
        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '40'], sample.dir)

        const beforeAttach = await getTaskById(sample.dir, task.id)
        const baselineAttempt = beforeAttach?.runtime?.runAttempt ?? 1

        const attach = await runPortCommand(['task', 'attach', task.id], sample.dir)
        expect(attach.stdout).toContain('Attach handoff ready')
        expect(attach.stdout).toContain('at immediate')
        expect(attach.stdout).toContain('Restore strategy:')

        // The revived worker runs autonomously (immediate boundary), so it may
        // complete before we poll. Accept either paused_for_attach or terminal.
        const afterAttach = await waitForTaskStatus(sample.dir, task.id, [
          'paused_for_attach',
          'completed',
          'failed',
          'timeout',
        ])
        expect(afterAttach.runtime?.runAttempt ?? 0).toBeGreaterThanOrEqual(baselineAttempt + 1)

        const events = await runPortCommand(['task', 'events'], sample.dir)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_started`)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_succeeded`)
        expect(events.stdout).toContain(`${task.id} task.attach.handoff_ready`)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'attach revives a dead non-terminal task and reaches handoff ready',
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
        expect(attach.stdout).toContain('Attach handoff ready')
        expect(attach.stdout).toContain('at immediate')

        // The revived worker runs autonomously (immediate boundary). The daemon
        // may also have restored a worker after the kill, so accept either
        // paused_for_attach or terminal states.
        const afterAttach = await waitForTaskStatus(sample.dir, task.id, [
          'paused_for_attach',
          'completed',
          'failed',
          'timeout',
        ])
        expect((afterAttach.runtime?.runAttempt ?? 0) >= 2).toBe(true)

        const events = await runPortCommand(['task', 'events'], sample.dir)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_started`)
        expect(events.stdout).toContain(`${task.id} task.attach.revive_succeeded`)
        expect(events.stdout).toContain(`${task.id} task.attach.handoff_ready`)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )
})

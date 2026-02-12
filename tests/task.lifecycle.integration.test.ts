import { describe, expect, test } from 'vitest'
import { prepareSample } from './utils'
import {
  cleanupTaskRuntime,
  runPortCommand,
  waitFor,
  waitForTaskByTitle,
  waitForTaskStatus,
  type IntegrationTaskRecord,
  getTaskById,
} from './taskIntegrationHelpers'

const TERMINAL = ['completed', 'failed', 'timeout', 'cancelled', 'cleaned']
const INTEGRATION_TIMEOUT = 60000

describe('task lifecycle integration', () => {
  test(
    'starts a background task and persists status transitions',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'story-start'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'story-start')

        await runPortCommand(
          ['task', 'wait', String(task.displayId), '--timeout-seconds', '30'],
          sample.dir
        )
        const finalTask = await waitForTaskStatus(sample.dir, task.id, TERMINAL)

        expect(TERMINAL).toContain(finalTask.status)

        const read = await runPortCommand(['task', 'read', String(task.displayId)], sample.dir)
        expect(read.stdout).toContain(task.id)
        expect(read.stdout).toContain(`#${task.displayId}`)
        expect(read.stdout).toContain('Recent events:')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'write tasks on the same branch queue and unblock in order',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(
          ['task', 'start', 'queue-first[sleep=3500]', '--branch', 'feat-queue'],
          sample.dir
        )
        const first = await waitForTaskByTitle(sample.dir, 'queue-first[sleep=3500]')

        await runPortCommand(
          ['task', 'start', 'queue-second', '--branch', 'feat-queue'],
          sample.dir
        )
        const second = await waitForTaskByTitle(sample.dir, 'queue-second')

        const blockedSecond = await waitFor(
          'second task blocked by first',
          async () => getTaskById(sample.dir, second.id),
          task => task.queue?.blockedByTaskId === first.id,
          { timeoutMs: 15000 }
        )
        expect(blockedSecond.queue?.blockedByTaskId).toBe(first.id)

        await runPortCommand(
          ['task', 'wait', String(first.displayId), '--timeout-seconds', '45'],
          sample.dir
        )

        const unblockedSecond = await waitFor(
          'second task unblocked',
          async () => getTaskById(sample.dir, second.id),
          task => !task.queue?.blockedByTaskId,
          { timeoutMs: 15000 }
        )
        expect(unblockedSecond.queue?.blockedByTaskId).toBeUndefined()

        await runPortCommand(
          ['task', 'wait', String(second.displayId), '--timeout-seconds', '45'],
          sample.dir
        )
        const finalSecond = await waitForTaskStatus(sample.dir, second.id, TERMINAL)
        expect(TERMINAL).toContain(finalSecond.status)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'write tasks on different branches are not blocked',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(
          ['task', 'start', 'branch-a[sleep=2500]', '--branch', 'feat-a'],
          sample.dir
        )
        await runPortCommand(
          ['task', 'start', 'branch-b[sleep=2500]', '--branch', 'feat-b'],
          sample.dir
        )

        const a = await waitForTaskByTitle(sample.dir, 'branch-a[sleep=2500]')
        const b = await waitForTaskByTitle(sample.dir, 'branch-b[sleep=2500]')

        const pair = await waitFor(
          'both branch tasks present without queue blockers',
          async () => {
            const [left, right] = await Promise.all([
              getTaskById(sample.dir, a.id),
              getTaskById(sample.dir, b.id),
            ])

            if (!left || !right) {
              return undefined
            }

            return [left, right] as [IntegrationTaskRecord, IntegrationTaskRecord]
          },
          ([left, right]) => !left.queue?.blockedByTaskId && !right.queue?.blockedByTaskId,
          { timeoutMs: 15000 }
        )

        expect(pair[0].queue?.blockedByTaskId).toBeUndefined()
        expect(pair[1].queue?.blockedByTaskId).toBeUndefined()

        await runPortCommand(
          ['task', 'wait', String(a.displayId), '--timeout-seconds', '45'],
          sample.dir
        )
        await runPortCommand(
          ['task', 'wait', String(b.displayId), '--timeout-seconds', '45'],
          sample.dir
        )
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'can cancel a running task and retain debug state',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(
          ['task', 'start', 'cancel-me[sleep=7000]', '--branch', 'feat-cancel'],
          sample.dir
        )
        const task = await waitForTaskByTitle(sample.dir, 'cancel-me[sleep=7000]')

        await waitFor(
          'task enters running-like state with worker pid',
          async () => getTaskById(sample.dir, task.id),
          value => Boolean(value.runtime?.workerPid),
          { timeoutMs: 15000 }
        )

        await runPortCommand(['task', 'cancel', String(task.displayId)], sample.dir)
        const cancelled = await waitForTaskStatus(sample.dir, task.id, ['cancelled'])
        expect(cancelled.runtime?.retainedForDebug).toBe(true)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'artifacts command reports expected files for completed write task',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'artifact-story'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'artifact-story')

        await runPortCommand(
          ['task', 'wait', String(task.displayId), '--timeout-seconds', '30'],
          sample.dir
        )

        const artifacts = await runPortCommand(
          ['task', 'artifacts', String(task.displayId)],
          sample.dir
        )
        expect(artifacts.stdout).toContain('metadata.json')
        expect(artifacts.stdout).toContain('commit-refs.json')
        expect(artifacts.stdout).toContain('changes.patch')
        expect(artifacts.stdout).toContain('stdout.log')
        expect(artifacts.stdout).toContain('stderr.log')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'task commands accept canonical and unique prefix references for compatibility',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'ref-compat'], sample.dir)
        const task = await waitForTaskByTitle(sample.dir, 'ref-compat')

        await runPortCommand(['task', 'wait', task.id, '--timeout-seconds', '30'], sample.dir)

        const canonicalRead = await runPortCommand(['task', 'read', task.id], sample.dir)
        expect(canonicalRead.stdout).toContain(task.id)

        const barePrefix = task.id.replace('task-', '').slice(0, 6)
        const prefixRead = await runPortCommand(['task', 'read', barePrefix], sample.dir)
        expect(prefixRead.stdout).toContain(task.id)
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )

  test(
    'ambiguous task prefix returns candidate guidance',
    async () => {
      const sample = await prepareSample('simple-server', { initWithConfig: true })

      try {
        await runPortCommand(['task', 'start', 'ambiguous-one'], sample.dir)
        await runPortCommand(['task', 'start', 'ambiguous-two'], sample.dir)

        const ambiguous = await runPortCommand(['task', 'read', 'task-'], sample.dir, {
          allowFailure: true,
        })
        expect(ambiguous.code).not.toBe(0)
        expect(ambiguous.stderr).toContain('is ambiguous')
        expect(ambiguous.stderr).toContain('use a longer prefix or numeric id')
      } finally {
        await cleanupTaskRuntime(sample.dir)
        await sample.cleanup()
      }
    },
    INTEGRATION_TIMEOUT
  )
})

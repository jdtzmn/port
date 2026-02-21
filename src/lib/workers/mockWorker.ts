import type { MockWorkerConfig } from '../../types.ts'
import type { TaskWorker, TaskWorkerContext, TaskWorkerResult } from '../taskWorker.ts'
import { execFileAsync } from '../exec.ts'

/**
 * Parse a sleep duration hint from the task title.
 * Matches [sleep=N] where N is milliseconds. Defaults to 750ms.
 */
function parseSleepHint(title: string): number {
  const match = title.match(/\[sleep=(\d+)\]/)
  if (!match?.[1]) {
    return 750
  }

  const parsed = Number.parseInt(match[1], 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return 750
  }

  return parsed
}

/**
 * Mock worker implementation for testing and development.
 *
 * Behavior is controlled by the task title (markers) and optional config:
 * - [sleep=N] in title: sleep for N ms (default 750ms)
 * - [fail] in title: throw an error after sleeping
 * - [edit] in title: simulate file edits (git status check in write mode)
 * - config.sleepMs: override sleep duration
 * - config.shouldFail: override failure behavior
 */
export class MockTaskWorker implements TaskWorker {
  readonly id: string
  readonly type = 'mock' as const
  private config: MockWorkerConfig

  constructor(id: string, config?: MockWorkerConfig) {
    this.id = id
    this.config = config ?? {}
  }

  async execute(ctx: TaskWorkerContext): Promise<TaskWorkerResult> {
    const sleepMs = this.config.sleepMs ?? parseSleepHint(ctx.task.title)

    // Validate worktree git context
    await execFileAsync('git', ['status', '--short'], { cwd: ctx.worktreePath })

    // Simulate work
    await new Promise(resolve => setTimeout(resolve, sleepMs))

    // Check failure conditions
    const shouldFail = this.config.shouldFail ?? ctx.task.title.includes('[fail]')
    if (shouldFail) {
      throw new Error('Task requested failure via [fail] marker')
    }

    // Simulate file edits in write mode
    if (ctx.task.mode === 'write' && ctx.task.title.includes('[edit]')) {
      await execFileAsync('git', ['status', '--short'], { cwd: ctx.worktreePath })
    }

    return { commitRefs: [] }
  }
}

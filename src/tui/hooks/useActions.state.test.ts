import { describe, expect, test } from 'bun:test'
import {
  INITIAL_ACTION_STATE,
  createEnqueueDecision,
  reduceActionState,
  type ActionJob,
  type ActionState,
} from './useActions.ts'

function makeJob(partial: Partial<ActionJob> & Pick<ActionJob, 'id' | 'worktreeName'>): ActionJob {
  return {
    id: partial.id,
    kind: partial.kind ?? 'up',
    worktreeName: partial.worktreeName,
    worktreePath: partial.worktreePath ?? `/repo/.port/trees/${partial.worktreeName}`,
    status: partial.status ?? 'queued',
    summary: partial.summary ?? `job ${partial.id}`,
    startedAt: partial.startedAt,
    endedAt: partial.endedAt,
    error: partial.error,
    logs: partial.logs ?? [],
  }
}

describe('createEnqueueDecision', () => {
  test('rejects second action on same worktree', () => {
    const state: ActionState = {
      ...INITIAL_ACTION_STATE,
      runningByWorktree: { 'feature-a': 'job-a' },
    }

    const result = createEnqueueDecision({
      state,
      kind: 'down',
      worktreePath: '/repo/.port/trees/feature-a',
      worktreeName: 'feature-a',
      summary: 'stop feature-a',
    })

    expect(result).toEqual({
      accepted: false,
      reason: 'worktree_busy',
      message: 'Action already running for feature-a',
    })
  })

  test('allows concurrent actions on different worktrees', () => {
    const state: ActionState = {
      ...INITIAL_ACTION_STATE,
      runningByWorktree: { 'feature-a': 'job-a' },
    }

    const result = createEnqueueDecision({
      state,
      kind: 'down',
      worktreePath: '/repo/.port/trees/feature-b',
      worktreeName: 'feature-b',
      summary: 'stop feature-b',
    })

    expect(result.accepted).toBe(true)
    if (result.accepted) {
      expect(result.job.worktreeName).toBe('feature-b')
      expect(result.job.kind).toBe('down')
      expect(result.job.status).toBe('queued')
    }
  })
})

describe('reduceActionState', () => {
  test('handles enqueue/start/log/finish transition sequence', () => {
    const job = makeJob({ id: 'job-1', worktreeName: 'feature-a' })

    const queued = reduceActionState(INITIAL_ACTION_STATE, { type: 'enqueue', job })
    expect(queued.order).toEqual(['job-1'])
    expect(queued.runningByWorktree['feature-a']).toBe('job-1')

    const running = reduceActionState(queued, { type: 'start', jobId: 'job-1', startedAt: 100 })
    expect(running.jobs['job-1']?.status).toBe('running')
    expect(running.jobs['job-1']?.startedAt).toBe(100)

    const logged = reduceActionState(running, {
      type: 'log',
      jobId: 'job-1',
      stream: 'stdout',
      line: 'hello',
      ts: 101,
    })
    expect(logged.jobs['job-1']?.logs).toEqual([{ ts: 101, stream: 'stdout', line: 'hello' }])

    const finished = reduceActionState(logged, {
      type: 'finish',
      jobId: 'job-1',
      status: 'success',
      endedAt: 102,
    })
    expect(finished.jobs['job-1']?.status).toBe('success')
    expect(finished.jobs['job-1']?.endedAt).toBe(102)
    expect(finished.runningByWorktree['feature-a']).toBeUndefined()
  })

  test('tracks only the last two streamed output lines per worktree', () => {
    const job = makeJob({ id: 'job-1', worktreeName: 'feature-a' })

    const queued = reduceActionState(INITIAL_ACTION_STATE, { type: 'enqueue', job })
    const afterOne = reduceActionState(queued, {
      type: 'log',
      jobId: 'job-1',
      stream: 'stdout',
      line: 'line-1',
      ts: 1,
    })
    const afterTwo = reduceActionState(afterOne, {
      type: 'log',
      jobId: 'job-1',
      stream: 'stderr',
      line: 'line-2',
      ts: 2,
    })
    const afterThree = reduceActionState(afterTwo, {
      type: 'log',
      jobId: 'job-1',
      stream: 'stdout',
      line: 'line-3',
      ts: 3,
    })

    expect(afterThree.outputTailByWorktree['feature-a']).toEqual([
      { stream: 'stderr', line: 'line-2' },
      { stream: 'stdout', line: 'line-3' },
    ])
  })

  test('trims old jobs and log lines', () => {
    const oldJob = makeJob({
      id: 'job-old',
      worktreeName: 'old',
      logs: [
        { ts: 1, stream: 'system', line: 'line-1' },
        { ts: 2, stream: 'system', line: 'line-2' },
      ],
    })
    const newJob = makeJob({
      id: 'job-new',
      worktreeName: 'new',
      logs: [
        { ts: 3, stream: 'system', line: 'line-3' },
        { ts: 4, stream: 'system', line: 'line-4' },
      ],
    })

    const queued = reduceActionState(
      reduceActionState(INITIAL_ACTION_STATE, { type: 'enqueue', job: oldJob }),
      { type: 'enqueue', job: newJob }
    )

    const trimmed = reduceActionState(queued, { type: 'trim', maxJobs: 1, maxLinesPerJob: 1 })
    expect(trimmed.order).toEqual(['job-new'])
    expect(Object.keys(trimmed.jobs)).toEqual(['job-new'])
    expect(trimmed.jobs['job-new']?.logs).toEqual([{ ts: 4, stream: 'system', line: 'line-4' }])
    expect(trimmed.runningByWorktree['old']).toBeUndefined()
    expect(trimmed.runningByWorktree['new']).toBe('job-new')
  })
})

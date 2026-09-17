import { describe, expect, it, vi } from 'vitest'
import { createRemoteObservationTasks } from './observationTasks.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function started() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('remote observation tasks', () => {
  it('deduplicates a live directory while admitting different directories', async () => {
    const releases = new Map<string, ReturnType<typeof deferred>>()
    const run = vi.fn((directory: string) => {
      const release = deferred()
      releases.set(directory, release)
      return release.promise
    })
    const tasks = createRemoteObservationTasks({ run })

    tasks.observe('/tmp/port-ssh-aaaaaa')
    tasks.observe('/tmp/port-ssh-aaaaaa')
    tasks.observe('/tmp/port-ssh-bbbbbb')
    await started()

    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls.map(([directory]) => directory)).toEqual([
      '/tmp/port-ssh-aaaaaa',
      '/tmp/port-ssh-bbbbbb',
    ])
    releases.get('/tmp/port-ssh-aaaaaa')!.resolve()
    releases.get('/tmp/port-ssh-bbbbbb')!.resolve()
    await tasks.close()
  })

  it('uses coordinator-owned signals that survive admission-call cancellation', async () => {
    const release = deferred()
    let taskSignal: AbortSignal | undefined
    const tasks = createRemoteObservationTasks({
      async run(_directory, signal) {
        taskSignal = signal
        await release.promise
      },
    })
    const request = new AbortController()

    tasks.observe('/tmp/port-ssh-aaaaaa')
    request.abort()
    await started()

    expect(taskSignal?.aborted).toBe(false)
    release.resolve()
    await tasks.close()
  })

  it('aborts and awaits settlement before unobserve resolves', async () => {
    const releases = [deferred(), deferred()]
    const signals: AbortSignal[] = []
    let index = 0
    const tasks = createRemoteObservationTasks({
      async run(_directory, ownedSignal) {
        signals.push(ownedSignal)
        await releases[index++]!.promise
      },
    })
    tasks.observe('/tmp/port-ssh-aaaaaa')
    await started()

    let finished = false
    const stopping = tasks.unobserve('/tmp/port-ssh-aaaaaa').then(() => {
      finished = true
    })
    await started()

    expect(signals[0]?.aborted).toBe(true)
    expect(finished).toBe(false)
    expect(() => tasks.observe('/tmp/port-ssh-aaaaaa')).toThrow(/stopping/)
    releases[0]!.resolve()
    await stopping
    expect(finished).toBe(true)

    tasks.observe('/tmp/port-ssh-aaaaaa')
    await started()
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    releases[1]!.resolve()
    await tasks.close()
  })

  it('treats an absent unobserve as idempotent success', async () => {
    const tasks = createRemoteObservationTasks({ run: vi.fn() })
    await expect(tasks.unobserve('/tmp/port-ssh-aaaaaa')).resolves.toBeUndefined()
    await tasks.close()
  })

  it('contains task failures and wakes after settlement', async () => {
    const onSettled = vi.fn()
    const tasks = createRemoteObservationTasks({
      run: vi.fn().mockRejectedValue(new Error('private observer failure')),
      onSettled,
    })

    tasks.observe('/tmp/port-ssh-aaaaaa')
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce())
    await expect(tasks.unobserve('/tmp/port-ssh-aaaaaa')).resolves.toBeUndefined()
    await tasks.close()
  })

  it('keeps a task admitted until its settlement callback finishes', async () => {
    const observation = deferred()
    const settlement = deferred()
    const run = vi.fn(() => observation.promise)
    const tasks = createRemoteObservationTasks({
      run,
      onSettled: () => settlement.promise,
    })
    tasks.observe('/tmp/port-ssh-aaaaaa')
    await started()
    observation.resolve()
    await started()

    let stopped = false
    const stopping = tasks.unobserve('/tmp/port-ssh-aaaaaa').then(() => {
      stopped = true
    })
    await started()

    expect(stopped).toBe(false)
    expect(() => tasks.observe('/tmp/port-ssh-aaaaaa')).toThrow(/stopping/)
    settlement.resolve()
    await stopping
    expect(stopped).toBe(true)
    await tasks.close()
  })

  it('bounds active tasks without evicting admitted work', async () => {
    const release = deferred()
    const tasks = createRemoteObservationTasks({
      capacity: 2,
      run: () => release.promise,
    })

    tasks.observe('/tmp/port-ssh-aaaaaa')
    tasks.observe('/tmp/port-ssh-bbbbbb')
    expect(() => tasks.observe('/tmp/port-ssh-cccccc')).toThrow(/capacity/)

    release.resolve()
    await tasks.close()
  })

  it('close refuses new work, aborts every task, and waits for all settlement', async () => {
    const releases = [deferred(), deferred()]
    const signals: AbortSignal[] = []
    let index = 0
    const tasks = createRemoteObservationTasks({
      async run(_directory, signal) {
        signals.push(signal)
        await releases[index++]!.promise
      },
    })
    tasks.observe('/tmp/port-ssh-aaaaaa')
    tasks.observe('/tmp/port-ssh-bbbbbb')
    await started()

    let closed = false
    const closing = tasks.close().then(() => {
      closed = true
    })
    await started()

    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(closed).toBe(false)
    expect(() => tasks.observe('/tmp/port-ssh-cccccc')).toThrow(/closed/)

    releases[0]!.resolve()
    await started()
    expect(closed).toBe(false)
    releases[1]!.resolve()
    await closing
    await expect(tasks.close()).resolves.toBeUndefined()
  })
})

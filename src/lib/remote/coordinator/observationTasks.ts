export interface RemoteObservationTaskOptions {
  run(directory: string, signal: AbortSignal): Promise<void>
  onSettled?(): void | Promise<void>
  capacity?: number
}

export interface RemoteObservationTasks {
  observe(directory: string): void
  unobserve(directory: string): Promise<void>
  close(): Promise<void>
}

interface RemoteObservationTask {
  controller: AbortController
  stopping: boolean
  done: Promise<void>
}

const DEFAULT_CAPACITY = 128

export function createRemoteObservationTasks(
  options: RemoteObservationTaskOptions
): RemoteObservationTasks {
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error('Remote observation capacity must be a positive integer')

  const tasks = new Map<string, RemoteObservationTask>()
  let closed = false
  let closing: Promise<void> | undefined

  function observe(directory: string): void {
    if (closed) throw new Error('Remote observation tasks are closed')
    const current = tasks.get(directory)
    if (current) {
      if (current.stopping) throw new Error('Remote observation task is stopping')
      return
    }
    if (tasks.size >= capacity) throw new Error('Remote observation task capacity exceeded')

    const task: RemoteObservationTask = {
      controller: new AbortController(),
      stopping: false,
      done: Promise.resolve(),
    }
    tasks.set(directory, task)
    task.done = (async () => {
      // Admission is visible before observer work can settle or call back into this manager.
      await Promise.resolve()
      try {
        await options.run(directory, task.controller.signal)
      } catch {
        /* Optional SSH observation failures never escape the coordinator task boundary. */
      } finally {
        try {
          await options.onSettled?.()
        } catch {
          /* Reconciliation wake failures are retried by the runtime loop. */
        } finally {
          if (tasks.get(directory) === task) tasks.delete(directory)
        }
      }
    })()
  }

  async function unobserve(directory: string): Promise<void> {
    const task = tasks.get(directory)
    if (!task) return
    task.stopping = true
    task.controller.abort()
    await task.done
  }

  function close(): Promise<void> {
    if (closing) return closing
    closed = true
    const admitted = [...tasks.values()]
    for (const task of admitted) {
      task.stopping = true
      task.controller.abort()
    }
    closing = Promise.allSettled(admitted.map(task => task.done)).then(() => {})
    return closing
  }

  return Object.freeze({ observe, unobserve, close })
}

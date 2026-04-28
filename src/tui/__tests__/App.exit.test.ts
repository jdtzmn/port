import { describe, expect, mock, test } from 'bun:test'
import type { ExitInfo } from '../index.tsx'
import { runGracefulExit } from '../App.tsx'

describe('runGracefulExit', () => {
  const exitInfo: ExitInfo = {
    activeWorktreeName: 'myapp',
    worktreePath: '/repo',
    changed: false,
  }

  test('requests exit immediately when no actions are running', async () => {
    const setStatus = mock(() => {})
    const setExiting = mock(() => {})
    const requestExit = mock(() => {})

    await runGracefulExit({
      getExitInfo: () => exitInfo,
      requestExit,
      getRunningActionCount: () => 0,
      shutdownJobs: async () => ({ cancelledCount: 0, timedOut: false, remaining: 0 }),
      setStatus,
      setExiting,
    })

    expect(setExiting).toHaveBeenCalledWith(true)
    expect(setStatus).not.toHaveBeenCalled()
    expect(requestExit).toHaveBeenCalledWith(exitInfo)
  })

  test('waits for shutdown and reports timeout before exit', async () => {
    const setStatusCalls: Array<{ text: string; type: 'success' | 'error' }> = []
    const requestExit = mock(() => {})
    let shutdownCalled = false

    await runGracefulExit({
      getExitInfo: () => exitInfo,
      requestExit,
      getRunningActionCount: () => 2,
      shutdownJobs: async () => {
        shutdownCalled = true
        return { cancelledCount: 2, timedOut: true, remaining: 1 }
      },
      setStatus: (text, type) => {
        setStatusCalls.push({ text, type })
      },
      setExiting: () => {},
    })

    expect(shutdownCalled).toBe(true)
    expect(setStatusCalls[0]).toEqual({
      text: 'Exiting... cancelling 2 running actions',
      type: 'success',
    })
    expect(setStatusCalls[1]).toEqual({
      text: 'Shutdown timed out with 1 action still running',
      type: 'error',
    })
    expect(requestExit).toHaveBeenCalledWith(exitInfo)
  })
})

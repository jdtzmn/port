import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { PortConfig, HostService } from '../../types.ts'
import { getComposeFile } from '../../lib/config.ts'
import {
  runCompose,
  writeOverrideFile,
  startTraefik,
  isTraefikRunning,
  restartTraefik,
  traefikHasRequiredPorts,
  parseComposeFile,
  getAllPorts,
  getProjectName,
} from '../../lib/compose.ts'
import { registerProject, unregisterProject } from '../../lib/registry.ts'
import { ensureTraefikPorts, traefikFilesExist, initTraefikFiles } from '../../lib/traefik.ts'
import { stopHostService } from '../../lib/hostService.ts'
import { getHostServicesForWorktree } from '../../lib/registry.ts'
import { removeWorktree } from '../../lib/git.ts'
import { archiveBranch } from '../../lib/git.ts'

export interface ActionResult {
  success: boolean
  message: string
}

export type ActionKind = 'up' | 'down' | 'archive' | 'kill-host-service'
export type ActionJobStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

interface ActionLogLine {
  ts: number
  stream: 'stdout' | 'stderr' | 'system'
  line: string
}

export interface OutputTailLine {
  stream: 'stdout' | 'stderr'
  line: string
}

export interface ActionJob {
  id: string
  kind: ActionKind
  worktreeName: string
  worktreePath: string
  status: ActionJobStatus
  summary: string
  startedAt?: number
  endedAt?: number
  error?: string
  logs: ActionLogLine[]
}

interface EnqueueSuccess {
  accepted: true
  jobId: string
}

interface EnqueueRejected {
  accepted: false
  reason: 'worktree_busy'
  message: string
}

export type EnqueueResult = EnqueueSuccess | EnqueueRejected

export interface ShutdownJobsResult {
  cancelledCount: number
  timedOut: boolean
  remaining: number
}

export interface ActionState {
  order: string[]
  jobs: Record<string, ActionJob>
  runningByWorktree: Record<string, string>
  outputTailByWorktree: Record<string, OutputTailLine[]>
  outputVisibleByWorktree: Record<string, boolean>
}

export type ActionEvent =
  | { type: 'enqueue'; job: ActionJob }
  | { type: 'start'; jobId: string; startedAt: number }
  | { type: 'log'; jobId: string; stream: ActionLogLine['stream']; line: string; ts: number }
  | {
      type: 'finish'
      jobId: string
      status: Extract<ActionJobStatus, 'success' | 'error' | 'cancelled'>
      endedAt: number
      error?: string
    }
  | { type: 'trim'; maxJobs: number; maxLinesPerJob: number }
  | { type: 'toggle-output-visible'; worktreeName: string }
  | { type: 'set-output-visible'; worktreeName: string; visible: boolean }

export const INITIAL_ACTION_STATE: ActionState = {
  order: [],
  jobs: {},
  runningByWorktree: {},
  outputTailByWorktree: {},
  outputVisibleByWorktree: {},
}

export function reduceActionState(state: ActionState, event: ActionEvent): ActionState {
  switch (event.type) {
    case 'enqueue': {
      return {
        ...state,
        order: [event.job.id, ...state.order],
        jobs: {
          ...state.jobs,
          [event.job.id]: event.job,
        },
        runningByWorktree: {
          ...state.runningByWorktree,
          [event.job.worktreeName]: event.job.id,
        },
        outputTailByWorktree: {
          ...state.outputTailByWorktree,
          [event.job.worktreeName]: [],
        },
        outputVisibleByWorktree: {
          ...state.outputVisibleByWorktree,
          [event.job.worktreeName]: true,
        },
      }
    }

    case 'start': {
      const existing = state.jobs[event.jobId]
      if (!existing) return state
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [event.jobId]: {
            ...existing,
            status: 'running',
            startedAt: event.startedAt,
          },
        },
      }
    }

    case 'log': {
      const existing = state.jobs[event.jobId]
      if (!existing) return state
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [event.jobId]: {
            ...existing,
            logs: [...existing.logs, { ts: event.ts, stream: event.stream, line: event.line }],
          },
        },
        outputTailByWorktree:
          event.stream === 'system'
            ? state.outputTailByWorktree
            : {
                ...state.outputTailByWorktree,
                [existing.worktreeName]: [
                  ...(state.outputTailByWorktree[existing.worktreeName] ?? []),
                  { stream: event.stream, line: event.line },
                ].slice(-2),
              },
      }
    }

    case 'finish': {
      const existing = state.jobs[event.jobId]
      if (!existing) return state
      const nextRunningByWorktree = { ...state.runningByWorktree }
      delete nextRunningByWorktree[existing.worktreeName]

      return {
        ...state,
        runningByWorktree: nextRunningByWorktree,
        outputVisibleByWorktree: {
          ...state.outputVisibleByWorktree,
          [existing.worktreeName]: false,
        },
        jobs: {
          ...state.jobs,
          [event.jobId]: {
            ...existing,
            status: event.status,
            endedAt: event.endedAt,
            error: event.error,
          },
        },
      }
    }

    case 'trim': {
      if (state.order.length <= event.maxJobs) {
        let changed = false
        const nextJobs: Record<string, ActionJob> = {}
        for (const jobId of state.order) {
          const job = state.jobs[jobId]
          if (!job) continue
          const trimmedLogs =
            job.logs.length > event.maxLinesPerJob
              ? job.logs.slice(-event.maxLinesPerJob)
              : job.logs
          if (trimmedLogs.length !== job.logs.length) {
            changed = true
            nextJobs[jobId] = { ...job, logs: trimmedLogs }
          } else {
            nextJobs[jobId] = job
          }
        }
        if (!changed) return state
        return { ...state, jobs: nextJobs }
      }

      const keptOrder = state.order.slice(0, event.maxJobs)
      const nextJobs: Record<string, ActionJob> = {}
      for (const jobId of keptOrder) {
        const job = state.jobs[jobId]
        if (!job) continue
        nextJobs[jobId] = {
          ...job,
          logs: job.logs.slice(-event.maxLinesPerJob),
        }
      }

      const nextRunningByWorktree: Record<string, string> = {}
      for (const [worktree, jobId] of Object.entries(state.runningByWorktree)) {
        if (nextJobs[jobId]) {
          nextRunningByWorktree[worktree] = jobId
        }
      }

      return {
        ...state,
        order: keptOrder,
        jobs: nextJobs,
        runningByWorktree: nextRunningByWorktree,
      }
    }

    case 'toggle-output-visible': {
      const current = state.outputVisibleByWorktree[event.worktreeName] ?? true
      return {
        ...state,
        outputVisibleByWorktree: {
          ...state.outputVisibleByWorktree,
          [event.worktreeName]: !current,
        },
      }
    }

    case 'set-output-visible': {
      return {
        ...state,
        outputVisibleByWorktree: {
          ...state.outputVisibleByWorktree,
          [event.worktreeName]: event.visible,
        },
      }
    }

    default:
      return state
  }
}

interface EnqueueDecisionAccepted {
  accepted: true
  job: ActionJob
}

type EnqueueDecision = EnqueueDecisionAccepted | EnqueueRejected

export function createEnqueueDecision(params: {
  state: ActionState
  kind: ActionKind
  worktreePath: string
  worktreeName: string
  summary: string
}): EnqueueDecision {
  if (params.state.runningByWorktree[params.worktreeName]) {
    return {
      accepted: false,
      reason: 'worktree_busy',
      message: `Action already running for ${params.worktreeName}`,
    }
  }

  return {
    accepted: true,
    job: {
      id: createJobId(params.kind, params.worktreeName),
      kind: params.kind,
      worktreePath: params.worktreePath,
      worktreeName: params.worktreeName,
      status: 'queued',
      summary: params.summary,
      logs: [],
    },
  }
}

function createJobId(kind: ActionKind, worktreeName: string): string {
  return `${kind}-${worktreeName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function waitForRunningActionsToDrain(options: {
  getState: () => ActionState
  timeoutMs: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<{ timedOut: boolean; remaining: number }> {
  const intervalMs = options.intervalMs ?? 50
  const sleep =
    options.sleep ??
    (async (ms: number) => {
      await new Promise(resolve => setTimeout(resolve, ms))
    })

  const startedAt = Date.now()
  while (true) {
    const remainingCount = Object.keys(options.getState().runningByWorktree).length
    if (remainingCount === 0) {
      return { timedOut: false, remaining: 0 }
    }

    if (Date.now() - startedAt >= options.timeoutMs) {
      return { timedOut: true, remaining: remainingCount }
    }

    await sleep(intervalMs)
  }
}

export function useActions(repoRoot: string, config: PortConfig, refresh: () => void) {
  const composeFile = getComposeFile(config)
  const [state, dispatch] = useReducer(reduceActionState, INITIAL_ACTION_STATE)
  const stateRef = useRef(state)
  const controllersRef = useRef(new Map<string, AbortController>())
  const infraLockRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const withInfraLock = useCallback(async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = infraLockRef.current
    let releaseLock!: () => void
    const current = new Promise<void>(resolve => {
      releaseLock = resolve
    })
    infraLockRef.current = current

    await previous
    try {
      return await work()
    } finally {
      releaseLock()
    }
  }, [])

  const appendSystemLog = useCallback((jobId: string, line: string) => {
    dispatch({ type: 'log', jobId, stream: 'system', line, ts: Date.now() })
  }, [])

  const runJob = useCallback(
    async (
      job: ActionJob,
      executor: (jobId: string, signal: AbortSignal) => Promise<ActionResult>
    ): Promise<void> => {
      const controller = new AbortController()
      controllersRef.current.set(job.id, controller)
      dispatch({ type: 'start', jobId: job.id, startedAt: Date.now() })
      appendSystemLog(job.id, `Starting ${job.kind} on ${job.worktreeName}`)

      try {
        const result = await executor(job.id, controller.signal)
        if (result.success) {
          appendSystemLog(job.id, result.message)
          dispatch({ type: 'finish', jobId: job.id, status: 'success', endedAt: Date.now() })
        } else if (controller.signal.aborted) {
          appendSystemLog(job.id, 'Action cancelled')
          dispatch({ type: 'finish', jobId: job.id, status: 'cancelled', endedAt: Date.now() })
        } else {
          appendSystemLog(job.id, result.message)
          dispatch({
            type: 'finish',
            jobId: job.id,
            status: 'error',
            endedAt: Date.now(),
            error: result.message,
          })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (controller.signal.aborted) {
          appendSystemLog(job.id, 'Action cancelled')
          dispatch({ type: 'finish', jobId: job.id, status: 'cancelled', endedAt: Date.now() })
        } else {
          appendSystemLog(job.id, message)
          dispatch({
            type: 'finish',
            jobId: job.id,
            status: 'error',
            endedAt: Date.now(),
            error: message,
          })
        }
      } finally {
        controllersRef.current.delete(job.id)
        refresh()
      }
    },
    [appendSystemLog, refresh]
  )

  const enqueue = useCallback(
    (
      kind: ActionKind,
      worktreePath: string,
      worktreeName: string,
      summary: string,
      executor: (jobId: string, signal: AbortSignal) => Promise<ActionResult>
    ): EnqueueResult => {
      const decision = createEnqueueDecision({
        state,
        kind,
        worktreePath,
        worktreeName,
        summary,
      })

      if (!decision.accepted) {
        return decision
      }

      const job = decision.job
      dispatch({ type: 'enqueue', job })
      dispatch({ type: 'trim', maxJobs: 20, maxLinesPerJob: 300 })
      void runJob(job, executor)
      return { accepted: true, jobId: job.id }
    },
    [runJob, state.runningByWorktree]
  )

  /**
   * Bring services up for a worktree.
   * Mirrors the logic in commands/up.ts but streams output into the action log.
   */
  const runUpWorktree = useCallback(
    async (
      worktreePath: string,
      worktreeName: string,
      jobId: string,
      signal: AbortSignal
    ): Promise<ActionResult> => {
      try {
        // Parse compose file
        const parsedCompose = await parseComposeFile(worktreePath, composeFile)
        const ports = getAllPorts(parsedCompose)

        await withInfraLock(async () => {
          // Ensure Traefik files
          if (!traefikFilesExist()) {
            await initTraefikFiles(ports)
          }
          await ensureTraefikPorts(ports)

          // Ensure Traefik is running
          const traefikRunning = await isTraefikRunning()
          if (!traefikRunning) {
            await startTraefik()
          } else if (!(await traefikHasRequiredPorts(ports))) {
            await restartTraefik()
          }
        })

        const projectName = getProjectName(repoRoot, worktreeName)

        // Write override
        await writeOverrideFile(
          worktreePath,
          parsedCompose,
          worktreeName,
          config.domain,
          projectName
        )

        // Start services and stream output into the action log.
        const result = await runCompose(
          worktreePath,
          composeFile,
          projectName,
          ['up', '-d'],
          { repoRoot, branch: worktreeName, domain: config.domain },
          {
            stdio: 'stream',
            signal,
            onStdoutLine: line =>
              dispatch({ type: 'log', jobId, stream: 'stdout', line, ts: Date.now() }),
            onStderrLine: line =>
              dispatch({ type: 'log', jobId, stream: 'stderr', line, ts: Date.now() }),
          }
        )

        if (result.exitCode !== 0) {
          return { success: false, message: 'Failed to start services' }
        }

        // Register project
        await registerProject(repoRoot, worktreeName, ports)
        return { success: true, message: `Services started in ${worktreeName}` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [repoRoot, config, composeFile, refresh, withInfraLock]
  )

  /**
   * Bring services down for a worktree.
   * Mirrors the logic in commands/down.ts but streams output into the action log.
   */
  const runDownWorktree = useCallback(
    async (
      worktreePath: string,
      worktreeName: string,
      jobId: string,
      signal: AbortSignal
    ): Promise<ActionResult> => {
      try {
        const projectName = getProjectName(repoRoot, worktreeName)

        const result = await runCompose(
          worktreePath,
          composeFile,
          projectName,
          ['down'],
          { repoRoot, branch: worktreeName, domain: config.domain },
          {
            stdio: 'stream',
            signal,
            onStdoutLine: line =>
              dispatch({ type: 'log', jobId, stream: 'stdout', line, ts: Date.now() }),
            onStderrLine: line =>
              dispatch({ type: 'log', jobId, stream: 'stderr', line, ts: Date.now() }),
          }
        )

        // Unregister project
        await unregisterProject(repoRoot, worktreeName)

        // Stop host services for this worktree
        const hostServices = await getHostServicesForWorktree(repoRoot, worktreeName)
        for (const svc of hostServices) {
          try {
            await stopHostService(svc)
          } catch {
            // Best effort
          }
        }

        if (result.exitCode !== 0) {
          return { success: false, message: 'Failed to stop services' }
        }

        return { success: true, message: `Services stopped in ${worktreeName}` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [repoRoot, config, composeFile, refresh]
  )

  /**
   * Archive a worktree (stop services, remove worktree, archive branch).
   */
  const runArchiveWorktree = useCallback(
    async (
      worktreePath: string,
      worktreeName: string,
      jobId: string,
      signal: AbortSignal
    ): Promise<ActionResult> => {
      try {
        // Stop services first
        const projectName = getProjectName(repoRoot, worktreeName)
        await runCompose(
          worktreePath,
          composeFile,
          projectName,
          ['down'],
          { repoRoot, branch: worktreeName, domain: config.domain },
          {
            stdio: 'stream',
            signal,
            onStdoutLine: line =>
              dispatch({ type: 'log', jobId, stream: 'stdout', line, ts: Date.now() }),
            onStderrLine: line =>
              dispatch({ type: 'log', jobId, stream: 'stderr', line, ts: Date.now() }),
          }
        )

        await unregisterProject(repoRoot, worktreeName)

        // Stop host services
        const hostServices = await getHostServicesForWorktree(repoRoot, worktreeName)
        for (const svc of hostServices) {
          try {
            await stopHostService(svc)
          } catch {
            // Best effort
          }
        }

        // Remove git worktree
        await removeWorktree(repoRoot, worktreeName, true)

        // Archive branch
        await archiveBranch(repoRoot, worktreeName)

        return { success: true, message: `Worktree ${worktreeName} archived` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [repoRoot, config, composeFile, refresh]
  )

  /**
   * Kill a specific host service.
   */
  const runKillHostService = useCallback(
    async (service: HostService): Promise<ActionResult> => {
      try {
        await stopHostService(service)
        refresh()
        return { success: true, message: `Stopped host service on port ${service.logicalPort}` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [refresh]
  )

  const upWorktree = useCallback(
    (worktreePath: string, worktreeName: string): EnqueueResult => {
      return enqueue(
        'up',
        worktreePath,
        worktreeName,
        `Starting services in ${worktreeName}`,
        (jobId, signal) => runUpWorktree(worktreePath, worktreeName, jobId, signal)
      )
    },
    [enqueue, runUpWorktree]
  )

  const downWorktree = useCallback(
    (worktreePath: string, worktreeName: string): EnqueueResult => {
      return enqueue(
        'down',
        worktreePath,
        worktreeName,
        `Stopping services in ${worktreeName}`,
        (jobId, signal) => runDownWorktree(worktreePath, worktreeName, jobId, signal)
      )
    },
    [enqueue, runDownWorktree]
  )

  const archiveWorktree = useCallback(
    (worktreePath: string, worktreeName: string): EnqueueResult => {
      return enqueue(
        'archive',
        worktreePath,
        worktreeName,
        `Archiving ${worktreeName}`,
        (jobId, signal) => runArchiveWorktree(worktreePath, worktreeName, jobId, signal)
      )
    },
    [enqueue, runArchiveWorktree]
  )

  const killHostService = useCallback(
    (service: HostService): EnqueueResult => {
      return enqueue(
        'kill-host-service',
        '',
        service.branch,
        `Stopping host service on ${service.branch}:${service.logicalPort}`,
        () => runKillHostService(service)
      )
    },
    [enqueue, runKillHostService]
  )

  const latestJobByWorktree = useMemo(() => {
    const entries = new Map<string, ActionJob>()
    for (const jobId of state.order) {
      const job = state.jobs[jobId]
      if (!job) continue
      if (!entries.has(job.worktreeName)) {
        entries.set(job.worktreeName, job)
      }
    }
    return entries
  }, [state])

  const isWorktreeBusy = useCallback(
    (worktreeName: string): boolean => Boolean(state.runningByWorktree[worktreeName]),
    [state.runningByWorktree]
  )

  const getOutputTail = useCallback(
    (worktreeName: string): OutputTailLine[] => state.outputTailByWorktree[worktreeName] ?? [],
    [state.outputTailByWorktree]
  )

  const isOutputVisible = useCallback(
    (worktreeName: string): boolean => state.outputVisibleByWorktree[worktreeName] ?? true,
    [state.outputVisibleByWorktree]
  )

  const toggleOutputVisible = useCallback((worktreeName: string): void => {
    dispatch({ type: 'toggle-output-visible', worktreeName })
  }, [])

  const showOutputForWorktree = useCallback((worktreeName: string): void => {
    dispatch({ type: 'set-output-visible', worktreeName, visible: true })
  }, [])

  const cancelWorktreeAction = useCallback(
    (worktreeName: string): boolean => {
      const runningJobId = state.runningByWorktree[worktreeName]
      if (!runningJobId) {
        return false
      }

      const controller = controllersRef.current.get(runningJobId)
      if (!controller) {
        return false
      }

      appendSystemLog(runningJobId, 'Cancellation requested')
      controller.abort()
      return true
    },
    [appendSystemLog, state.runningByWorktree]
  )

  const getRunningActionCount = useCallback(
    (): number => Object.keys(state.runningByWorktree).length,
    [state.runningByWorktree]
  )

  const shutdownJobs = useCallback(
    async (options?: { timeoutMs?: number }): Promise<ShutdownJobsResult> => {
      const runningJobIds = [...new Set(Object.values(stateRef.current.runningByWorktree))]

      for (const jobId of runningJobIds) {
        const controller = controllersRef.current.get(jobId)
        if (!controller) continue
        appendSystemLog(jobId, 'Cancellation requested (shutdown)')
        controller.abort()
      }

      const drainResult = await waitForRunningActionsToDrain({
        getState: () => stateRef.current,
        timeoutMs: options?.timeoutMs ?? 5000,
      })

      return {
        cancelledCount: runningJobIds.length,
        timedOut: drainResult.timedOut,
        remaining: drainResult.remaining,
      }
    },
    [appendSystemLog]
  )

  return {
    upWorktree,
    downWorktree,
    archiveWorktree,
    killHostService,
    latestJobByWorktree,
    isWorktreeBusy,
    getOutputTail,
    isOutputVisible,
    toggleOutputVisible,
    showOutputForWorktree,
    cancelWorktreeAction,
    getRunningActionCount,
    shutdownJobs,
  }
}

import type { PortTask } from './taskStore.ts'
import type { WorkerDefinition, WorkerType } from '../types.ts'
import { loadConfig } from './config.ts'
import { MockTaskWorker } from './workers/mockWorker.ts'
import { OpenCodeTaskWorker } from './workers/opencodeWorker.ts'

/**
 * Metadata from an OpenCode session checkpoint, used for --continue support.
 */
export interface OpenCodeCheckpointMetadata {
  sessionId?: string
  transcriptPath?: string
  workspaceRef?: string
  fallbackSummary?: string
}

/**
 * Context provided to a worker's execute() method by the framework harness.
 */
export interface TaskWorkerContext {
  /** The task being executed */
  task: PortTask
  /** Absolute path to the repo root */
  repoRoot: string
  /** Absolute path to the ephemeral worktree */
  worktreePath: string
  /** Append a line to the task's stdout artifact log */
  appendStdout(line: string): Promise<void>
  /** Append a line to the task's stderr artifact log */
  appendStderr(line: string): Promise<void>
}

/**
 * Result returned by a worker after execution completes.
 */
export interface TaskWorkerResult {
  /** Git commit SHAs produced during execution (empty if none) */
  commitRefs: string[]
  /** Optional human-readable summary of what was done */
  summary?: string
  /** Optional OpenCode session metadata for checkpoint/restore */
  opencode?: OpenCodeCheckpointMetadata
}

/**
 * Contract for a task worker implementation.
 *
 * Workers define what happens inside the spawned process — the actual work.
 * The framework harness handles status transitions, error handling, and
 * artifact collection. The worker just does the work and returns results.
 * Throw to signal failure.
 */
export interface TaskWorker {
  /** Instance name (from config key, e.g., "main", "deep") */
  readonly id: string
  /** Worker type (e.g., "opencode", "mock") */
  readonly type: WorkerType
  /** Execute the task. Called after status is set to 'running'. */
  execute(context: TaskWorkerContext): Promise<TaskWorkerResult>
}

/**
 * Factory: create a TaskWorker from a named instance definition.
 */
export function createTaskWorker(instanceName: string, definition: WorkerDefinition): TaskWorker {
  switch (definition.type) {
    case 'opencode':
      return new OpenCodeTaskWorker(instanceName, definition.config)
    case 'mock':
      return new MockTaskWorker(instanceName, definition.config)
    default: {
      const _exhaustive: never = definition
      throw new Error(`Unknown worker type: ${(_exhaustive as WorkerDefinition).type}`)
    }
  }
}

/**
 * Resolve a TaskWorker by instance name from the project config.
 *
 * @param repoRoot - Absolute path to the repo root (for loading config)
 * @param workerName - The worker instance name to resolve
 * @returns The constructed TaskWorker
 * @throws If the worker name is not found in config
 */
export async function resolveTaskWorker(repoRoot: string, workerName: string): Promise<TaskWorker> {
  const config = await loadConfig(repoRoot)
  const workers = config.task?.workers

  if (!workers || !workers[workerName]) {
    throw new Error(
      `Worker "${workerName}" not found in config. ` +
        `Available: ${workers ? Object.keys(workers).join(', ') : '(none)'}`
    )
  }

  return createTaskWorker(workerName, workers[workerName])
}

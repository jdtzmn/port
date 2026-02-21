import { randomUUID } from 'crypto'
import { loadConfig } from './config.ts'
import {
  type AttachContext,
  type AttachHandoffReady,
  type AttachResumeToken,
  LocalTaskExecutionAdapter,
  type PreparedExecution,
  type TaskCheckpointRef,
  type TaskExecutionAdapter,
  type TaskRunHandle,
} from './taskAdapter.ts'
import type { PortTask } from './taskStore.ts'

export interface TaskAdapterDescriptor {
  id: string
  kind: 'local' | 'remote'
  description: string
  capabilities: {
    supportsCheckpoint: boolean
    supportsRestore: boolean
    supportsAttachHandoff: boolean
    supportsResumeToken: boolean
    supportsTranscript: boolean
    supportsFailedSnapshot: boolean
  }
}

class StubRemoteTaskExecutionAdapter implements TaskExecutionAdapter {
  readonly id = 'stub-remote'
  readonly capabilities = {
    supportsCheckpoint: true,
    supportsRestore: true,
    supportsAttachHandoff: false,
    supportsResumeToken: false,
    supportsTranscript: false,
    supportsFailedSnapshot: false,
  }

  async prepare(_repoRoot: string, task: PortTask): Promise<PreparedExecution> {
    return {
      taskId: task.id,
      runId: randomUUID(),
      worktreePath: '',
      branch: `stub-${task.id}`,
    }
  }

  async start(
    _repoRoot: string,
    task: PortTask,
    _prepared: PreparedExecution
  ): Promise<TaskRunHandle> {
    throw new Error(`Remote stub adapter does not execute task ${task.id} yet`)
  }

  async status(_handle: TaskRunHandle): Promise<'running' | 'exited'> {
    return 'exited'
  }

  async checkpoint(_handle: TaskRunHandle): Promise<TaskCheckpointRef> {
    throw new Error('stub-remote does not support checkpoints yet')
  }

  async restore(
    _repoRoot: string,
    task: PortTask,
    _checkpoint: TaskCheckpointRef
  ): Promise<TaskRunHandle> {
    throw new Error(`Remote stub adapter does not restore task ${task.id} yet`)
  }

  async requestHandoff(_handle: TaskRunHandle): Promise<AttachHandoffReady> {
    throw new Error('stub-remote does not support attach handoff yet')
  }

  async attachContext(_handle: TaskRunHandle): Promise<AttachContext> {
    throw new Error('stub-remote does not provide attach context yet')
  }

  async resumeFromAttach(_handle: TaskRunHandle, _token?: AttachResumeToken): Promise<void> {
    throw new Error('stub-remote does not support attach resume yet')
  }

  async cancel(_handle: TaskRunHandle): Promise<void> {
    // no-op for stub
  }

  async cleanup(_repoRoot: string, _handle: TaskRunHandle): Promise<void> {
    // no-op for stub
  }
}

const TASK_ADAPTERS: TaskAdapterDescriptor[] = [
  {
    id: 'local',
    kind: 'local',
    description: 'Runs workers locally in ephemeral worktrees',
    capabilities: {
      supportsCheckpoint: true,
      supportsRestore: true,
      supportsAttachHandoff: true,
      supportsResumeToken: false,
      supportsTranscript: false,
      supportsFailedSnapshot: false,
    },
  },
  {
    id: 'stub-remote',
    kind: 'remote',
    description: 'Remote adapter contract stub (transport intentionally deferred)',
    capabilities: {
      supportsCheckpoint: true,
      supportsRestore: true,
      supportsAttachHandoff: false,
      supportsResumeToken: false,
      supportsTranscript: false,
      supportsFailedSnapshot: false,
    },
  },
]

export function listTaskAdapters(): TaskAdapterDescriptor[] {
  return [...TASK_ADAPTERS]
}

export function createTaskAdapter(adapterId: string, scriptPath: string): TaskExecutionAdapter {
  if (adapterId === 'local') {
    return new LocalTaskExecutionAdapter(scriptPath)
  }

  if (adapterId === 'stub-remote') {
    return new StubRemoteTaskExecutionAdapter()
  }

  throw new Error(`Unknown task adapter: ${adapterId}`)
}

export async function resolveTaskAdapter(
  repoRoot: string,
  scriptPath: string
): Promise<{
  adapter: TaskExecutionAdapter
  configuredId: string
  resolvedId: string
  fallbackUsed: boolean
}> {
  let configuredId = 'local'
  try {
    const config = await loadConfig(repoRoot)
    // Adapter resolution will move to per-worker in port-5ep.3;
    // for now default to 'local' from config if no workers are defined
    configuredId = 'local'
  } catch {
    configuredId = 'local'
  }

  try {
    const adapter = createTaskAdapter(configuredId, scriptPath)
    return {
      adapter,
      configuredId,
      resolvedId: configuredId,
      fallbackUsed: false,
    }
  } catch {
    const adapter = createTaskAdapter('local', scriptPath)
    return {
      adapter,
      configuredId,
      resolvedId: 'local',
      fallbackUsed: true,
    }
  }
}

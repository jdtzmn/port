import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { join, resolve } from 'path'

export interface PortCommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface IntegrationTaskRecord {
  id: string
  displayId: number
  title: string
  status: string
  branch?: string
  queue?: {
    lockKey?: string
    blockedByTaskId?: string
  }
  runtime?: {
    runAttempt?: number
    activeRunId?: string
    runs?: Array<{
      attempt: number
      runId: string
      status: string
      startedAt: string
      finishedAt?: string
      reason?: string
    }>
    workerPid?: number
    checkpoint?: {
      runId: string
    }
    checkpointHistory?: Array<{ runId: string }>
    retainedForDebug?: boolean
  }
}

function cliScript(): string {
  return resolve(__dirname, '../src/index.ts')
}

export async function runPortCommand(
  args: string[],
  cwd: string,
  options: { allowFailure?: boolean; timeoutMs?: number } = {}
): Promise<PortCommandResult> {
  const timeoutMs = options.timeoutMs ?? 45000

  const result = await new Promise<PortCommandResult>(resolveResult => {
    const child = spawn('bun', [cliScript(), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
    }, timeoutMs)

    child.stdout?.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })

    child.on('close', code => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolveResult({
        code: code ?? 1,
        stdout,
        stderr,
      })
    })
  })

  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(
      [
        `Command failed: port ${args.join(' ')}`,
        `stdout:\n${result.stdout}`,
        `stderr:\n${result.stderr}`,
      ].join('\n\n')
    )
  }

  return result
}

export async function readTaskIndex(repoRoot: string): Promise<IntegrationTaskRecord[]> {
  const path = join(repoRoot, '.port', 'jobs', 'index.json')
  if (!existsSync(path)) {
    return []
  }

  const raw = await readFile(path, 'utf-8')
  const parsed = JSON.parse(raw) as { tasks?: IntegrationTaskRecord[] }
  return parsed.tasks ?? []
}

export async function getTaskById(
  repoRoot: string,
  taskId: string
): Promise<IntegrationTaskRecord | undefined> {
  const tasks = await readTaskIndex(repoRoot)
  return tasks.find(task => task.id === taskId)
}

export async function waitFor<T>(
  label: string,
  factory: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30000
  const intervalMs = options.intervalMs ?? 100
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const value = await factory()
    if (value !== undefined && predicate(value)) {
      return value
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for ${label}`)
}

export async function waitForTaskByTitle(
  repoRoot: string,
  title: string,
  options: { timeoutMs?: number } = {}
): Promise<IntegrationTaskRecord> {
  return waitFor(
    `task with title ${title}`,
    async () => {
      const tasks = await readTaskIndex(repoRoot)
      return tasks.find(task => task.title === title)
    },
    task => Boolean(task.id),
    { timeoutMs: options.timeoutMs }
  )
}

export async function waitForTaskStatus(
  repoRoot: string,
  taskId: string,
  statuses: string[],
  options: { timeoutMs?: number } = {}
): Promise<IntegrationTaskRecord> {
  const wanted = new Set(statuses)
  return waitFor(
    `task ${taskId} status ${statuses.join(',')}`,
    async () => getTaskById(repoRoot, taskId),
    task => wanted.has(task.status),
    { timeoutMs: options.timeoutMs }
  )
}

export async function writePortConfig(repoRoot: string, config: object): Promise<void> {
  const path = join(repoRoot, '.port', 'config.jsonc')
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)
}

export async function cleanupTaskRuntime(repoRoot: string): Promise<void> {
  await runPortCommand(['task', 'cleanup'], repoRoot, { allowFailure: true, timeoutMs: 15000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  await runPortCommand(['task', 'cleanup'], repoRoot, { allowFailure: true, timeoutMs: 15000 })
  await new Promise(resolve => setTimeout(resolve, 800))
}

import { spawn } from 'child_process'
import { existsSync, constants } from 'fs'
import { access, mkdir, appendFile } from 'fs/promises'
import { join } from 'path'
import { getPortDir, HOOKS_DIR, LOGS_DIR, LATEST_LOG } from './config.ts'

/**
 * Available hook types
 * Add new hooks here as they are implemented
 */
export type HookName = 'post-create'

/**
 * Environment variables passed to hooks
 */
export interface HookEnv {
  /** Absolute path to the main repository root */
  PORT_ROOT_PATH: string
  /** Absolute path to the worktree (if applicable) */
  PORT_WORKTREE_PATH?: string
  /** The branch name (sanitized) */
  PORT_BRANCH?: string
}

/**
 * Result of running a hook
 */
export interface HookResult {
  /** Whether the hook succeeded (exit code 0) */
  success: boolean
  /** The exit code of the hook script */
  exitCode: number
}

/**
 * Get the path to the hooks directory
 */
export function getHooksDir(repoRoot: string): string {
  return join(getPortDir(repoRoot), HOOKS_DIR)
}

/**
 * Get the path to a specific hook script
 */
export function getHookPath(repoRoot: string, hookName: HookName): string {
  return join(getHooksDir(repoRoot), `${hookName}.sh`)
}

/**
 * Get the path to the logs directory
 */
export function getLogsDir(repoRoot: string): string {
  return join(getPortDir(repoRoot), LOGS_DIR)
}

/**
 * Get the path to the latest log file
 */
export function getLogPath(repoRoot: string): string {
  return join(getLogsDir(repoRoot), LATEST_LOG)
}

/**
 * Check if a hook script exists and is executable
 */
export async function hookExists(repoRoot: string, hookName: HookName): Promise<boolean> {
  const hookPath = getHookPath(repoRoot, hookName)

  if (!existsSync(hookPath)) {
    return false
  }

  try {
    await access(hookPath, constants.X_OK)
    return true
  } catch {
    // File exists but is not executable
    return false
  }
}

/**
 * Format a timestamp for logging
 */
function formatTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')

  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  return `${date} ${time}`
}

/**
 * Format a log prefix
 */
function formatPrefix(branch: string, hookName: HookName): string {
  return `[${branch} ${hookName}]`
}

/**
 * Append a line to the log file with timestamp and prefix
 */
export async function appendLog(
  repoRoot: string,
  branch: string,
  hookName: HookName,
  message: string
): Promise<void> {
  const logsDir = getLogsDir(repoRoot)
  const logPath = getLogPath(repoRoot)

  // Ensure logs directory exists
  if (!existsSync(logsDir)) {
    await mkdir(logsDir, { recursive: true })
  }

  const timestamp = formatTimestamp()
  const prefix = formatPrefix(branch, hookName)
  const line = `[${timestamp}] ${prefix} ${message}\n`

  await appendFile(logPath, line)
}

/**
 * Run a hook script with environment variables
 *
 * Streams stdout/stderr to both terminal and log file
 *
 * @param repoRoot - The repository root path
 * @param hookName - The name of the hook to run
 * @param env - Environment variables to pass to the hook
 * @param branch - Branch name for logging prefix
 * @returns Hook result with success status and exit code
 */
export async function runHook(
  repoRoot: string,
  hookName: HookName,
  env: HookEnv,
  branch: string
): Promise<HookResult> {
  const hookPath = getHookPath(repoRoot, hookName)

  // Log start
  await appendLog(repoRoot, branch, hookName, 'Running hook...')

  return new Promise(resolve => {
    const child = spawn(hookPath, [], {
      cwd: env.PORT_WORKTREE_PATH ?? env.PORT_ROOT_PATH,
      env: {
        ...process.env,
        ...env,
      },
      shell: true,
    })

    // Handle stdout - stream to terminal and log
    child.stdout?.on('data', async (data: Buffer) => {
      const lines = data.toString().trim().split('\n')
      for (const line of lines) {
        process.stdout.write(`  ${line}\n`)
        await appendLog(repoRoot, branch, hookName, line)
      }
    })

    // Handle stderr - stream to terminal and log
    child.stderr?.on('data', async (data: Buffer) => {
      const lines = data.toString().trim().split('\n')
      for (const line of lines) {
        process.stderr.write(`  ${line}\n`)
        await appendLog(repoRoot, branch, hookName, line)
      }
    })

    child.on('close', async code => {
      const exitCode = code ?? 1
      const success = exitCode === 0

      if (success) {
        await appendLog(repoRoot, branch, hookName, `Hook completed (exit code ${exitCode})`)
      } else {
        await appendLog(repoRoot, branch, hookName, `Hook failed (exit code ${exitCode})`)
      }

      resolve({ success, exitCode })
    })

    child.on('error', async error => {
      await appendLog(repoRoot, branch, hookName, `Hook error: ${error.message}`)
      resolve({ success: false, exitCode: 1 })
    })
  })
}

/**
 * Run the post-create hook for a newly created worktree
 *
 * Convenience wrapper around runHook for the post-create hook
 */
export async function runPostCreateHook(options: {
  repoRoot: string
  worktreePath: string
  branch: string
}): Promise<HookResult> {
  const { repoRoot, worktreePath, branch } = options

  return runHook(
    repoRoot,
    'post-create',
    {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: branch,
    },
    branch
  )
}

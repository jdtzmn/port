import { spawn } from 'child_process'
import { existsSync, constants } from 'fs'
import { access, appendFile } from 'fs/promises'
import { join } from 'path'
import { getPortDir, HOOKS_DIR } from './config.ts'
import { getLogsDir, getLogPath, ensureLogsDir } from './logs.ts'
import { formatHostname, formatHostnameLabel } from './hostname.ts'

export type HookScope = 'worktree' | 'main'

export interface HookDefinition {
  /** Contexts where `port hook <name>` is allowed */
  manualScopes: HookScope[]
}

/**
 * Hook definitions and policy metadata.
 */
export const HOOK_DEFINITIONS = {
  'post-create': {
    manualScopes: ['worktree'],
  },
  'post-up': {
    manualScopes: ['worktree', 'main'],
  },
  'pre-run': {
    manualScopes: ['worktree'],
  },
} as const satisfies Record<string, HookDefinition>

/** Available hook names derived from HOOK_DEFINITIONS */
export type HookName = keyof typeof HOOK_DEFINITIONS

/** All available hook names */
export const HOOK_NAMES = Object.keys(HOOK_DEFINITIONS) as HookName[]

/**
 * Check if a hook can be run manually in the current context.
 */
export function canRunHookInContext(hookName: HookName, isMainRepo: boolean): boolean {
  const currentScope: HookScope = isMainRepo ? 'main' : 'worktree'
  const allowedScopes = HOOK_DEFINITIONS[hookName].manualScopes as readonly HookScope[]
  return allowedScopes.includes(currentScope)
}

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
  /** Domain suffix from port config */
  PORT_DOMAIN?: string
  /** Truncated, sanitized hostname label (matches the label used for Traefik routing) */
  PORT_HOSTNAME_LABEL?: string
  /** Full hostname: PORT_HOSTNAME_LABEL + '.' + PORT_DOMAIN */
  PORT_HOSTNAME?: string

  /** File path where hooks can append KEY=VALUE lines to override child env */
  PORT_ENV_FILE?: string
  /** Logical port requested by the user */
  PORT_LOGICAL_PORT?: string
  /** Actual ephemeral port allocated for the host process */
  PORT_ACTUAL_PORT?: string
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

// Re-export log helpers for backwards compatibility
export { getLogsDir, getLogPath }

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
  const logPath = getLogPath(repoRoot)

  await ensureLogsDir(repoRoot)

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
  const hookEnv: HookEnv = {
    ...env,
    ...buildHostnameEnv(env.PORT_BRANCH, env.PORT_DOMAIN),
  }
  const pendingLogWrites: Promise<void>[] = []

  const queueLog = (message: string): void => {
    pendingLogWrites.push(appendLog(repoRoot, branch, hookName, message))
  }

  // Log start
  await appendLog(repoRoot, branch, hookName, 'Running hook...')

  return new Promise(resolve => {
    // No shell: the hook path is executed directly (hooks are executable and
    // carry a shebang), so repo paths containing spaces are not word-split.
    const child = spawn(hookPath, [], {
      cwd: hookEnv.PORT_WORKTREE_PATH ?? hookEnv.PORT_ROOT_PATH,
      env: {
        ...process.env,
        ...hookEnv,
      },
    })

    // Handle stdout - stream to terminal and log
    child.stdout?.on('data', async (data: Buffer) => {
      const lines = data.toString().trim().split('\n')
      for (const line of lines) {
        process.stdout.write(`  ${line}\n`)
        queueLog(line)
      }
    })

    // Handle stderr - stream to terminal and log
    child.stderr?.on('data', async (data: Buffer) => {
      const lines = data.toString().trim().split('\n')
      for (const line of lines) {
        process.stderr.write(`  ${line}\n`)
        queueLog(line)
      }
    })

    child.on('close', async code => {
      const exitCode = code ?? 1
      const success = exitCode === 0

      await Promise.allSettled(pendingLogWrites)

      if (success) {
        await appendLog(repoRoot, branch, hookName, `Hook completed (exit code ${exitCode})`)
      } else {
        await appendLog(repoRoot, branch, hookName, `Hook failed (exit code ${exitCode})`)
      }

      resolve({ success, exitCode })
    })

    child.on('error', async error => {
      await Promise.allSettled(pendingLogWrites)
      await appendLog(repoRoot, branch, hookName, `Hook error: ${error.message}`)
      resolve({ success: false, exitCode: 1 })
    })
  })
}

/**
 * Build the PORT_HOSTNAME_LABEL / PORT_HOSTNAME env entries for a branch.
 *
 * PORT_HOSTNAME_LABEL is only computed when a branch is known.
 * PORT_HOSTNAME additionally requires a domain (matches formatHostname).
 */
function buildHostnameEnv(
  branch?: string,
  domain?: string
): Pick<HookEnv, 'PORT_HOSTNAME_LABEL' | 'PORT_HOSTNAME'> {
  if (!branch) {
    return {}
  }

  return {
    PORT_HOSTNAME_LABEL: formatHostnameLabel(branch),
    PORT_HOSTNAME: domain ? formatHostname(branch, domain) : undefined,
  }
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
  domain?: string
}): Promise<HookResult> {
  const { repoRoot, worktreePath, branch, domain } = options

  return runHook(
    repoRoot,
    'post-create',
    {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: branch,
      PORT_DOMAIN: domain,
      ...buildHostnameEnv(branch, domain),
    },
    branch
  )
}

/**
 * Run the post-up hook after services start in a worktree
 */
export async function runPostUpHook(options: {
  repoRoot: string
  worktreePath: string
  branch: string
  domain: string
}): Promise<HookResult> {
  const { repoRoot, worktreePath, branch, domain } = options

  return runHook(
    repoRoot,
    'post-up',
    {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: branch,
      PORT_DOMAIN: domain,
      ...buildHostnameEnv(branch, domain),
    },
    branch
  )
}

/**
 * Run the pre-run hook before starting a host process.
 *
 * The hook can append KEY=VALUE lines to PORT_ENV_FILE to override environment
 * variables passed to the spawned command.
 */
export async function runPreRunHook(options: {
  repoRoot: string
  worktreePath: string
  branch: string
  domain: string
  logicalPort: number
  actualPort: number
  envFile: string
}): Promise<HookResult> {
  const { repoRoot, worktreePath, branch, domain, logicalPort, actualPort, envFile } = options

  return runHook(
    repoRoot,
    'pre-run',
    {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: branch,
      PORT_DOMAIN: domain,
      ...buildHostnameEnv(branch, domain),
      PORT_LOGICAL_PORT: logicalPort.toString(),
      PORT_ACTUAL_PORT: actualPort.toString(),
      PORT_ENV_FILE: envFile,
    },
    branch
  )
}

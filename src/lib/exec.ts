import { exec, spawn, type SpawnOptions } from 'child_process'
import { promisify } from 'util'

/**
 * Promisified version of child_process.exec
 */
export const execAsync = promisify(exec)

const MACOS_GUI_UNAVAILABLE_ERRORS = [
  'No user interaction allowed',
  '(-1713)',
  'Not authorized to send Apple events',
  'not authorized to send Apple events',
  'Connection is invalid',
  'error retrieving current directory: getcwd',
  'Operation not permitted - getcwd',
]

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function shouldUseMacOSGuiAuth(): boolean {
  if (process.platform !== 'darwin') {
    return false
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false
  }

  if (process.env.CI) {
    return false
  }

  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
    return false
  }

  return true
}

function getErrorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return ''
  }

  let text = error.message

  if ('stderr' in error && typeof error.stderr === 'string') {
    text += `\n${error.stderr}`
  }

  return text
}

function isMacOSGuiUnavailableError(error: unknown): boolean {
  const errorText = getErrorText(error)

  return MACOS_GUI_UNAVAILABLE_ERRORS.some(pattern => errorText.includes(pattern))
}

function buildMacOSPrivilegeCommand(command: string): string {
  const script = [
    'on run argv',
    'set targetCommand to item 1 of argv',
    'do shell script targetCommand with administrator privileges',
    'end run',
  ]

  const args = script.map(line => `-e ${shellQuote(line)}`).join(' ')
  return `/usr/bin/osascript ${args} ${shellQuote(command)}`
}

function buildSudoCommand(command: string): string {
  return `sudo sh -c ${shellQuote(command)}`
}

// ---------------------------------------------------------------------------
// Batched privileged execution
// ---------------------------------------------------------------------------

interface BatchedCommand {
  command: string
  options?: Parameters<typeof execAsync>[1]
  resolve: (result: Awaited<ReturnType<typeof execAsync>>) => void
  reject: (error: unknown) => void
}

let commandBatch: BatchedCommand[] = []

/**
 * Queue a privileged command to be executed in a batch.
 * Commands are not executed until `flushPrivilegedBatch()` is called.
 *
 * This allows multiple privileged operations to be combined into a single
 * authentication prompt on macOS GUI sessions.
 *
 * @example
 * ```ts
 * queuePrivileged('mkdir -p /etc/port')
 * queuePrivileged('echo "config" > /etc/port/config')
 * await flushPrivilegedBatch()
 * ```
 */
export function queuePrivileged(
  command: string,
  options?: Parameters<typeof execAsync>[1]
): Promise<Awaited<ReturnType<typeof execAsync>>> {
  return new Promise((resolve, reject) => {
    commandBatch.push({ command, options, resolve, reject })
  })
}

/**
 * Execute all queued privileged commands in a single batch.
 *
 * On macOS GUI sessions, this combines all commands into one shell script
 * executed via osascript, requiring only a single authentication prompt.
 *
 * On non-GUI or non-macOS contexts, commands are executed sequentially via sudo.
 *
 * @returns Promise that resolves when all commands complete
 */
export async function flushPrivilegedBatch(): Promise<void> {
  if (commandBatch.length === 0) {
    return
  }

  const batch = commandBatch
  commandBatch = []

  // If there's only one command, use the direct execution path
  if (batch.length === 1) {
    const cmd = batch[0]
    if (!cmd) return

    try {
      const result = await execPrivileged(cmd.command, cmd.options)
      cmd.resolve(result)
    } catch (error) {
      cmd.reject(error)
      throw error
    }
    return
  }

  // Combine all commands into a single script
  const combinedScript = batch.map(cmd => cmd.command).join('\n')

  // All commands should use the same cwd (default to '/')
  const cwd = batch[0]?.options?.cwd ?? '/'

  try {
    const result = await execPrivileged(combinedScript, { cwd })

    // Resolve all promises with the combined result
    // In a batch, we assume all-or-nothing execution
    for (const cmd of batch) {
      cmd.resolve(result)
    }
  } catch (error) {
    // If the batch fails, reject all promises
    for (const cmd of batch) {
      cmd.reject(error)
    }
    // Re-throw so the flush operation itself fails
    throw error
  }
}

/**
 * Clear the current batch without executing.
 * Rejects all queued commands with a cancellation error.
 */
export function clearPrivilegedBatch(): void {
  const batch = commandBatch
  commandBatch = []

  const error = new Error('Privileged command batch was cleared')
  for (const cmd of batch) {
    cmd.reject(error)
  }
}

/**
 * Get the number of commands currently queued in the batch.
 */
export function getPrivilegedBatchSize(): number {
  return commandBatch.length
}

/**
 * Execute a command with elevated privileges.
 *
 * - macOS GUI sessions use the native authentication prompt (osascript)
 * - non-GUI or non-macOS contexts use sudo
 *
 * For multiple privileged operations, consider using `queuePrivileged()` and
 * `flushPrivilegedBatch()` to reduce the number of authentication prompts.
 */
export async function execPrivileged(
  command: string,
  options?: Parameters<typeof execAsync>[1]
): Promise<Awaited<ReturnType<typeof execAsync>>> {
  const privilegedOptions = {
    ...options,
    cwd: options?.cwd ?? '/',
  }

  if (shouldUseMacOSGuiAuth()) {
    try {
      return await execAsync(buildMacOSPrivilegeCommand(command), privilegedOptions)
    } catch (error) {
      if (!isMacOSGuiUnavailableError(error)) {
        throw error
      }
    }
  }

  return execAsync(buildSudoCommand(command), privilegedOptions)
}

/**
 * Execute a command with stdio inherited (for interactive commands)
 *
 * This is useful for commands like `docker compose exec` or `docker compose logs -f`
 * where you want the user to interact directly with the process.
 *
 * @param command - The command to execute (will be parsed by shell)
 * @param options - Options for spawning the process
 * @returns Promise that resolves with exit code when the process completes
 */
export async function execWithStdio(
  command: string,
  options: { cwd?: string } = {}
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      stdio: 'inherit',
      shell: true,
    }

    const child = spawn(command, [], spawnOptions)

    child.on('error', error => {
      reject(error)
    })

    child.on('close', code => {
      // When stdio is 'inherit', process.stdin gets ref'd by the child,
      // which keeps the event loop alive after the child exits. Unref it
      // so the parent process can exit naturally once all work is done.
      process.stdin.unref()
      resolve({ exitCode: code ?? 0 })
    })
  })
}

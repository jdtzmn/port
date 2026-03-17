import { exec, spawn, type SpawnOptions } from 'child_process'
import { promisify } from 'util'
import { createInterface } from 'readline'

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

/**
 * Execute a command with elevated privileges.
 *
 * - macOS GUI sessions use the native authentication prompt (osascript)
 * - non-GUI or non-macOS contexts use sudo
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

interface ExecStreamingOptions {
  cwd?: string
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

/**
 * Execute a command and stream stdout/stderr line-by-line to callbacks.
 */
export async function execStreaming(
  command: string,
  options: ExecStreamingOptions = {}
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    }

    const child = spawn(command, [], spawnOptions)

    const stdoutReader = child.stdout
      ? createInterface({ input: child.stdout, crlfDelay: Infinity })
      : null
    const stderrReader = child.stderr
      ? createInterface({ input: child.stderr, crlfDelay: Infinity })
      : null

    stdoutReader?.on('line', line => {
      options.onStdoutLine?.(line)
    })

    stderrReader?.on('line', line => {
      options.onStderrLine?.(line)
    })

    let killTimer: ReturnType<typeof setTimeout> | null = null
    const abortHandler = () => {
      child.kill('SIGINT')
      killTimer = setTimeout(() => {
        child.kill('SIGTERM')
      }, 1500)
    }

    if (options.signal) {
      if (options.signal.aborted) {
        abortHandler()
      } else {
        options.signal.addEventListener('abort', abortHandler, { once: true })
      }
    }

    child.on('error', error => {
      stdoutReader?.close()
      stderrReader?.close()
      if (killTimer) clearTimeout(killTimer)
      reject(error)
    })

    child.on('close', code => {
      stdoutReader?.close()
      stderrReader?.close()
      if (killTimer) clearTimeout(killTimer)
      resolve({ exitCode: code ?? 0 })
    })
  })
}

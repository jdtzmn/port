import { exec, execFile, spawn, type SpawnOptions } from 'child_process'
import { promisify } from 'util'

/**
 * Promisified version of child_process.exec
 */
export const execAsync = promisify(exec)

/**
 * Promisified version of child_process.execFile.
 *
 * Prefer this for commands that can be expressed as binary + argv,
 * especially when any argument is dynamic/user-controlled.
 */
export const execFileAsync = promisify(execFile)

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
      resolve({ exitCode: code ?? 0 })
    })
  })
}

/**
 * Execute a command with stdio inherited using explicit argv.
 *
 * This avoids shell parsing and should be preferred whenever possible.
 */
export async function execWithArgs(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      stdio: 'inherit',
      shell: false,
    }

    const child = spawn(command, args, spawnOptions)

    child.on('error', error => {
      reject(error)
    })

    child.on('close', code => {
      resolve({ exitCode: code ?? 0 })
    })
  })
}

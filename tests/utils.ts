import { render } from 'cli-testing-library'
import { basename, join, resolve } from 'path'
import { cp, mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import type { PortConfig } from '../src/types'
import { execAsync, execFileAsync } from '../src/lib/exec'
import { CONFIG_FILE, PORT_DIR, TREES_DIR } from '../src/lib/config'
import { sanitizeFolderName } from '../src/lib/sanitize'

/**
 * Global registry of temp directories created by prepareSample
 * These are automatically cleaned up after all tests complete
 */
export const tempDirRegistry = new Set<string>()

function projectNameFromDir(dir: string) {
  return sanitizeFolderName(basename(dir))
}

function cliScript() {
  return resolve(__dirname, '../src/index.ts')
}

export function renderCLI(args: string[] = [], cwd?: string) {
  return render('bun', [cliScript(), ...args], {
    cwd,
  })
}

export async function execPortAsync(args: string[] = [], cwd?: string) {
  // Use execFile (no shell) so the CLI script path and individual args are
  // passed verbatim. This keeps branch names containing spaces intact instead
  // of letting the shell split them into separate words.
  return execFileAsync('bun', [cliScript(), ...args], {
    cwd,
  })
}

async function pruneUnusedDockerNetworks(): Promise<void> {
  try {
    await execAsync('docker network prune -f')
  } catch {
    // Ignore when Docker is unavailable or pruning fails.
  }
}

interface SampleConfig {
  /**
   * Whether dir should have git initialized. Forced to true if initWithConfig is true.
   */
  gitInit?: boolean

  /**
   * Whether to run `port init`. If true, uses default config.
   * Otherwise, uses the provided config.
   */
  initWithConfig?: PortConfig | true

  /**
   * Name of a subdirectory (inside the temp dir) to place the sample in.
   * Useful for exercising repo paths that contain spaces.
   */
  dirName?: string
}

/**
 * Prepare a sample in a temp directory.
 *
 * Returns a dictionary containing `dir` string and `cleanup` method
 *
 * Temp directories are automatically cleaned up after all tests complete.
 * You can also manually call the cleanup function to remove the directory immediately.
 */
export async function prepareSample(sampleName: string, config?: SampleConfig) {
  const rootDir = await mkdtemp(join(tmpdir(), 'port-test-'))

  tempDirRegistry.add(rootDir)

  const tempDir = config?.dirName ? join(rootDir, config.dirName) : rootDir

  const samplePath = resolve(__dirname, 'samples', sampleName)
  await cp(samplePath, tempDir, { recursive: true })

  if (config?.gitInit || config?.initWithConfig) {
    await execAsync('git init', { cwd: tempDir })
    await execAsync('git add .', { cwd: tempDir })
    await execAsync('git commit -m "Initial commit"', { cwd: tempDir })
    await execAsync('git branch -M main', { cwd: tempDir })
  }

  if (config?.initWithConfig === true) {
    await execPortAsync(['init'], tempDir)
  } else if (config?.initWithConfig) {
    await execPortAsync(['init'], tempDir)
    const fileContents = JSON.stringify(config.initWithConfig, undefined, 2)
    await writeFile(join(tempDir, PORT_DIR, CONFIG_FILE), fileContents)
  }

  const domain = (config?.initWithConfig !== true && config?.initWithConfig?.domain) || 'port'
  const urlWithPort = (port: number) => `http://${projectNameFromDir(tempDir)}.${domain}:${port}`

  return {
    dir: tempDir,
    urlWithPort,
    cleanup: async () => {
      await bringDownComposeProject(tempDir)
      await rm(rootDir, { recursive: true, force: true })
      tempDirRegistry.delete(rootDir)
    },
  }
}

/**
 * Clean up all registered temp directories
 * Called automatically by vitest afterAll hook
 */
export async function cleanupAllTempDirs() {
  await Promise.all(
    Array.from(tempDirRegistry).map(async dir => {
      try {
        await rm(dir, { recursive: true, force: true })
      } catch (error) {
        console.error(`Failed to clean up temp directory ${dir}:`, error)
      }
    })
  )
  tempDirRegistry.clear()
}

/**
 * Bring down a compose project within a directory
 */
async function bringDownComposeDirectory(dir: string) {
  try {
    await execAsync(`docker compose --project-directory "${dir}" down`)
  } catch {
    // Ignore errors - compose might not have been started for this directory
  }

  await pruneUnusedDockerNetworks()
}

/**
 * Bring down a compose project within this directory and all the worktrees
 */
async function bringDownComposeProject(projectDir: string) {
  try {
    const worktrees = await readdir(join(projectDir, PORT_DIR, TREES_DIR))
    await Promise.all(
      worktrees.map(async worktree => {
        await bringDownComposeDirectory(join(projectDir, PORT_DIR, TREES_DIR, worktree))
      })
    )
  } catch {
    // Ignore errors - worktrees might not exist
  }

  await bringDownComposeDirectory(projectDir)
}

/**
 * Bring down all of the compose projects in temporary directories
 */
export async function bringDownAllComposeProjects() {
  await Promise.all(Array.from(tempDirRegistry).map(dir => bringDownComposeProject(dir)))
  await pruneUnusedDockerNetworks()
}

/**
 * Stop compose services for a single directory without touching Traefik.
 *
 * Tests MUST use this instead of `port down -y` for cleanup because
 * `port down -y` tears down the shared Traefik container when its registry
 * is empty, breaking any other parallel test that still depends on routing.
 */
export async function safeDown(worktreePath: string): Promise<void> {
  try {
    await execAsync(`docker compose --project-directory "${worktreePath}" down`)
  } catch {
    // Best-effort cleanup - compose may not have been started.
  }

  await pruneUnusedDockerNetworks()
}

/**
 * Fetch with a timeout to prevent hung requests from consuming the entire poll window.
 */
export async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

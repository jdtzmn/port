import { render } from 'cli-testing-library'
import { basename, resolve } from 'path'
import { mkdtempSync } from 'fs'
import { cp, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PortConfig } from '../src/types'
import { execAsync } from '../src/lib/exec'
import { writeFile } from 'fs/promises'
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
  return execAsync(`bun ${cliScript()} ` + args.join(' '), {
    cwd,
  })
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
  // Create temp directory
  const tempDir = mkdtempSync(join(tmpdir(), 'port-test-'))

  // Register temp directory for automatic cleanup
  tempDirRegistry.add(tempDir)

  // Copy sample to temp directory
  const samplePath = resolve(__dirname, 'samples', sampleName)
  await cp(samplePath, tempDir, { recursive: true })

  // Handle side effects
  if (config?.gitInit || config?.initWithConfig) {
    // Initialize the git repository
    await execAsync('git init', { cwd: tempDir })

    // Create initial commit
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

  // `urlWithPort` helper function
  const domain = (config?.initWithConfig !== true && config?.initWithConfig?.domain) || 'port'
  const urlWithPort = (port: number) => `http://${projectNameFromDir(tempDir)}.${domain}:${port}`

  // Return dir and cleanup function
  return {
    dir: tempDir,
    urlWithPort,
    cleanup: async () => {
      await bringDownComposeProject(tempDir)
      await rm(tempDir, { recursive: true, force: true })
      tempDirRegistry.delete(tempDir)
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
}

/**
 * Bring down a compose project within this directory and all the worktrees
 */
async function bringDownComposeProject(projectDir: string) {
  // If worktrees in `.port/trees`, bring those down
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

  // Bring down the project itself
  await bringDownComposeDirectory(projectDir)
}

/**
 * Bring down all of the compose projects in temporary directories
 */
export async function bringDownAllComposeProjects() {
  await Promise.all(Array.from(tempDirRegistry).map(dir => bringDownComposeProject(dir)))
}

import { render } from 'cli-testing-library'
import { basename, resolve } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { cp } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PortConfig } from '../src/types'
import { execAsync } from '../src/lib/exec'
import { writeFile } from 'fs/promises'
import { CONFIG_FILE, PORT_DIR } from '../src/lib/config'
import { sanitizeFolderName } from '../src/lib/sanitize'

/**
 * Global registry of temp directories created by prepareSample
 * These are automatically cleaned up after all tests complete
 */
export const tempDirRegistry = new Set<string>()

/**
 * Global registry of all running compose projects
 * These are automatically cleaned up after all tests complete
 */
export const composeProjectRegistry = new Set<string>()

function projectNameFromDir(dir: string) {
  return sanitizeFolderName(basename(dir))
}

export function renderCLI(args: string[] = [], cwd?: string) {
  return render('bun', [resolve(__dirname, '../src/index.ts'), ...args], {
    cwd,
  })
}

export async function execPortAsync(args: string[] = [], cwd?: string) {
  return execAsync(`bun ${resolve(__dirname, '../src/index.ts')} ` + args.join(' '), {
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
  composeProjectRegistry.add(projectNameFromDir(tempDir))

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
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true })
      tempDirRegistry.delete(tempDir)
    },
  }
}

/**
 * Clean up all registered temp directories
 * Called automatically by vitest afterAll hook
 */
export function cleanupAllTempDirs() {
  for (const dir of tempDirRegistry) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      console.error(`Failed to clean up temp directory ${dir}:`, error)
    }
  }
  tempDirRegistry.clear()
}

export async function bringDownAllComposeProjects() {
  await Promise.all(
    Array.from(composeProjectRegistry).map(async projectName => {
      try {
        await execAsync(`docker compose -p ${projectName} down`)
      } catch (error) {
        console.error(`Failed to bring down compose project ${projectName}:`, error)
      }
    })
  )
}

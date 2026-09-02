import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { getPortDir, LOGS_DIR, LATEST_LOG } from './config.ts'
import { sanitizeBranchName } from './sanitize.ts'

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
 * Get the path to a detached host service log file
 */
export function getServiceLogPath(repoRoot: string, branch: string, logicalPort: number): string {
  return join(getLogsDir(repoRoot), `${sanitizeBranchName(branch)}-${logicalPort}.log`)
}

/**
 * Ensure the logs directory exists
 */
export async function ensureLogsDir(repoRoot: string): Promise<void> {
  const logsDir = getLogsDir(repoRoot)

  if (!existsSync(logsDir)) {
    await mkdir(logsDir, { recursive: true })
  }
}

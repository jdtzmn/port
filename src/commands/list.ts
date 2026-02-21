import { existsSync, readdirSync } from 'fs'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile, getTreesDir } from '../lib/config.ts'
import { isTraefikRunning } from '../lib/compose.ts'
import { getAllHostServices } from '../lib/registry.ts'
import { isProcessRunning, cleanupStaleHostServices } from '../lib/hostService.ts'
import { collectWorktreeStatuses } from '../lib/worktreeStatus.ts'
import { sanitizeFolderName } from '../lib/sanitize.ts'
import * as output from '../lib/output.ts'

/**
 * Get worktree names from the .port/trees/ directory without any expensive
 * Docker or Traefik checks. Returns an empty array if not in a port repo.
 */
export function getWorktreeNames(repoRoot: string): string[] {
  const names: string[] = []

  // Add the main repo itself (same logic as collectWorktreeStatuses)
  const repoName = sanitizeFolderName(repoRoot.split('/').pop() ?? 'main')
  names.push(repoName)

  const treesDir = getTreesDir(repoRoot)
  if (!existsSync(treesDir)) {
    return names
  }

  const entries = readdirSync(treesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      names.push(entry.name)
    }
  }

  return names
}

/**
 * List worktree names only, one per line. Fast path that skips Docker/Traefik checks.
 */
export function listNames(): void {
  try {
    const repoRoot = detectWorktree().repoRoot
    if (!configExists(repoRoot)) return
    const names = getWorktreeNames(repoRoot)
    for (const name of names) {
      console.log(name)
    }
  } catch {
    // Not in a git repo or no port config — output nothing
  }
}

/**
 * List concise worktree-level status and host services
 */
export async function list(options: { names?: boolean } = {}): Promise<void> {
  if (options.names) {
    listNames()
    return
  }

  let worktrees: Array<{ name: string; running: boolean }> = []

  try {
    const repoRoot = detectWorktree().repoRoot

    if (configExists(repoRoot)) {
      const config = await loadConfig(repoRoot)
      const composeFile = getComposeFile(config)
      worktrees = await collectWorktreeStatuses(repoRoot, composeFile, config.domain)
    } else {
      output.info(
        'Current repository is not initialized with port. Showing global service status only.'
      )
    }
  } catch {
    output.info('Not in a git repository. Showing global service status only.')
  }

  // Output
  output.header('Active worktrees:')
  output.newline()

  for (const wt of worktrees) {
    const statusIcon = wt.running ? output.branch('(running)') : '(stopped)'
    console.log(`${output.branch(wt.name)} ${statusIcon}`)
  }

  output.newline()

  // Clean up stale host services and display running ones
  await cleanupStaleHostServices()
  const hostServices = await getAllHostServices()

  if (hostServices.length > 0) {
    output.header('Host Services:')
    output.newline()

    for (const svc of hostServices) {
      const running = isProcessRunning(svc.pid)
      const statusIcon = running ? output.branch('(running)') : '(dead)'
      console.log(
        `${output.branch(svc.branch)}:${svc.logicalPort} -> localhost:${svc.actualPort} ${statusIcon}`
      )
      console.log(`  pid: ${svc.pid}`)
    }

    output.newline()
  }

  // Check Traefik status
  const traefikRunning = await isTraefikRunning()
  if (traefikRunning) {
    output.success(`Traefik: running (dashboard: ${output.url('http://localhost:1211')})`)
  } else {
    output.dim('Traefik: not running')
  }
}

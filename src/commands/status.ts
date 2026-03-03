import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import { isTraefikRunning } from '../lib/compose.ts'
import { getAllHostServices } from '../lib/registry.ts'
import { isProcessRunning, cleanupStaleHostServices } from '../lib/hostService.ts'
import { collectWorktreeStatuses, type WorktreeStatus } from '../lib/worktreeStatus.ts'
import * as output from '../lib/output.ts'

/**
 * Show per-service status details grouped by worktree, host services, and Traefik.
 * Degrades gracefully outside a git repo or non-port project by showing global
 * service status only.
 */
export async function status(): Promise<void> {
  let worktrees: WorktreeStatus[] = []

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

  output.header('Worktree service status:')
  output.newline()

  for (const worktree of worktrees) {
    const statusLabel = worktree.running ? output.branch('(running)') : '(stopped)'
    console.log(`${output.branch(worktree.name)} ${statusLabel}`)

    for (const service of worktree.services) {
      const ports = service.ports.length > 0 ? service.ports.join(', ') : 'no published ports'
      const serviceStatus = service.running ? 'running' : 'stopped'
      console.log(`  ${service.name}: ${ports} (${serviceStatus})`)
    }

    output.newline()
  }

  await cleanupStaleHostServices()
  const hostServices = await getAllHostServices()

  if (hostServices.length > 0) {
    output.header('Host Services:')
    output.newline()

    for (const service of hostServices) {
      const running = isProcessRunning(service.pid)
      const statusLabel = running ? output.branch('(running)') : '(dead)'
      console.log(
        `${output.branch(service.branch)}:${service.logicalPort} -> localhost:${service.actualPort} ${statusLabel}`
      )
      console.log(`  pid: ${service.pid}`)
    }

    output.newline()
  }

  const traefikRunning = await isTraefikRunning()
  if (traefikRunning) {
    output.success(`Traefik: running (dashboard: ${output.url('http://localhost:1211')})`)
  } else {
    output.dim('Traefik: not running')
  }
}

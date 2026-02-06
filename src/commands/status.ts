import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import { isTraefikRunning } from '../lib/compose.ts'
import { getAllHostServices } from '../lib/registry.ts'
import { isProcessRunning, cleanupStaleHostServices } from '../lib/hostService.ts'
import { collectWorktreeStatuses } from '../lib/worktreeStatus.ts'
import * as output from '../lib/output.ts'

/**
 * Show per-service status details grouped by worktree
 */
export async function status(): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    output.error('Not in a git repository')
    process.exit(1)
  }

  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  const config = await loadConfig(repoRoot)
  const composeFile = getComposeFile(config)
  const worktrees = await collectWorktreeStatuses(repoRoot, composeFile, config.domain)

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

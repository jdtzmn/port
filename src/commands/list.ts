import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { findGitRoot } from '../lib/worktree.ts'
import { getTreesDir, loadConfig, configExists } from '../lib/config.ts'
import { composePs } from '../lib/compose.ts'
import { isTraefikRunning } from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import * as output from '../lib/output.ts'

interface WorktreeStatus {
  name: string
  path: string
  services: Array<{
    name: string
    ports: number[]
    running: boolean
  }>
  running: boolean
}

/**
 * Get status of a worktree's services
 */
async function getWorktreeStatus(
  worktreePath: string,
  composeFile: string,
  configServices: Array<{ name: string; ports: number[] }>
): Promise<WorktreeStatus['services']> {
  const services: WorktreeStatus['services'] = []

  // Try to get compose status
  const psResult = await composePs(worktreePath, composeFile)
  const runningServices = new Map(psResult.map(s => [s.name, s.running]))

  for (const service of configServices) {
    // Check if service is running (docker-compose service names may have prefixes)
    const isRunning = Array.from(runningServices.entries()).some(
      ([name, running]) => name.includes(service.name) && running
    )

    services.push({
      name: service.name,
      ports: service.ports,
      running: isRunning,
    })
  }

  return services
}

/**
 * List all worktrees and their status
 */
export async function list(): Promise<void> {
  // Find git root
  const repoRoot = findGitRoot(process.cwd())

  if (!repoRoot) {
    output.error('Not in a git repository')
    process.exit(1)
  }

  // Check if port is initialized
  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  const config = await loadConfig(repoRoot)
  const treesDir = getTreesDir(repoRoot)
  const worktrees: WorktreeStatus[] = []

  // Check main repo
  const mainServices = await getWorktreeStatus(
    repoRoot,
    config.compose ?? 'docker-compose.yml',
    config.services
  )
  const mainRunning = mainServices.some(s => s.running)

  // Get folder name for main repo
  const repoName = sanitizeBranchName(repoRoot.split('/').pop() ?? 'main')

  worktrees.push({
    name: repoName,
    path: repoRoot,
    services: mainServices,
    running: mainRunning,
  })

  // Check worktrees in .port/trees/
  if (existsSync(treesDir)) {
    const entries = readdirSync(treesDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const worktreePath = join(treesDir, entry.name)
      const services = await getWorktreeStatus(
        worktreePath,
        config.compose ?? 'docker-compose.yml',
        config.services
      )
      const running = services.some(s => s.running)

      worktrees.push({
        name: entry.name,
        path: worktreePath,
        services,
        running,
      })
    }
  }

  // Output
  output.header('Active worktrees:')
  output.newline()

  for (const wt of worktrees) {
    const statusIcon = wt.running ? output.branch('(running)') : '(stopped)'
    console.log(`${output.branch(wt.name)} ${statusIcon}`)

    for (const service of wt.services) {
      const serviceStatus = service.running ? 'running' : 'stopped'
      const ports = service.ports.join(', ')
      console.log(`  ${service.name}: ${ports} (${serviceStatus})`)
    }

    output.newline()
  }

  // Check Traefik status
  const traefikRunning = await isTraefikRunning()
  if (traefikRunning) {
    output.success(`Traefik: running (dashboard: ${output.url('http://localhost:8080')})`)
  } else {
    output.dim('Traefik: not running')
  }
}

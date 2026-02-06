import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { detectWorktree } from '../lib/worktree.ts'
import { getTreesDir, loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import {
  composePs,
  isTraefikRunning,
  parseComposeFile,
  getServicePorts,
  getProjectName,
} from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import { getAllHostServices } from '../lib/registry.ts'
import { isProcessRunning, cleanupStaleHostServices } from '../lib/hostService.ts'
import * as output from '../lib/output.ts'
import { failWithError } from '../lib/cli.ts'

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
  repoRoot: string,
  branch: string,
  domain: string,
  worktreePath: string,
  composeFile: string,
  projectName: string
): Promise<WorktreeStatus['services']> {
  const services: WorktreeStatus['services'] = []

  try {
    // Parse compose file to get service info
    const parsedCompose = await parseComposeFile(worktreePath, composeFile)

    // Try to get compose status
    const psResult = await composePs(worktreePath, composeFile, projectName, {
      repoRoot,
      branch,
      domain,
    })
    const runningServices = new Map(psResult.map(s => [s.name, s.running]))

    for (const [serviceName, service] of Object.entries(parsedCompose.services)) {
      const ports = getServicePorts(service)

      // Check if service is running (docker-compose service names may have prefixes)
      const isRunning = Array.from(runningServices.entries()).some(
        ([name, running]) => name.includes(serviceName) && running
      )

      services.push({
        name: serviceName,
        ports,
        running: isRunning,
      })
    }
  } catch {
    // Compose file might not exist in this worktree
  }

  return services
}

/**
 * List all worktrees and their status
 */
export async function list(): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }

  // Check if port is initialized
  if (!configExists(repoRoot)) {
    failWithError('Port not initialized. Run "port init" first.')
  }

  const config = await loadConfig(repoRoot)
  const composeFile = getComposeFile(config)
  const treesDir = getTreesDir(repoRoot)
  const worktrees: WorktreeStatus[] = []

  // Get folder name for main repo
  const repoName = sanitizeBranchName(repoRoot.split('/').pop() ?? 'main')

  // Check main repo - use the same project name logic
  const mainProjectName = getProjectName(repoRoot, repoName)
  const mainServices = await getWorktreeStatus(
    repoRoot,
    repoName,
    config.domain,
    repoRoot,
    composeFile,
    mainProjectName
  )
  const mainRunning = mainServices.some(s => s.running)

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
      const worktreeProjectName = getProjectName(repoRoot, entry.name)
      const services = await getWorktreeStatus(
        repoRoot,
        entry.name,
        config.domain,
        worktreePath,
        composeFile,
        worktreeProjectName
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

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getTreesDir } from './config.ts'
import { composePs, parseComposeFile, getServicePorts, getProjectName } from './compose.ts'
import { sanitizeBranchName } from './sanitize.ts'

export interface WorktreeServiceStatus {
  name: string
  ports: number[]
  running: boolean
}

export interface WorktreeStatus {
  name: string
  path: string
  services: WorktreeServiceStatus[]
  running: boolean
}

async function getWorktreeServiceStatus(
  repoRoot: string,
  branch: string,
  domain: string,
  worktreePath: string,
  composeFile: string,
  projectName: string
): Promise<WorktreeServiceStatus[]> {
  const services: WorktreeServiceStatus[] = []

  try {
    const parsedCompose = await parseComposeFile(worktreePath, composeFile)
    const psResult = await composePs(worktreePath, composeFile, projectName, {
      repoRoot,
      branch,
      domain,
    })
    const runningServices = new Map(psResult.map(service => [service.name, service.running]))

    for (const [serviceName, service] of Object.entries(parsedCompose.services)) {
      const ports = getServicePorts(service)
      const running = Array.from(runningServices.entries()).some(
        ([name, isRunning]) => name.includes(serviceName) && isRunning
      )

      services.push({
        name: serviceName,
        ports,
        running,
      })
    }
  } catch {
    // Compose file may not exist in this worktree.
  }

  return services
}

export async function collectWorktreeStatuses(
  repoRoot: string,
  composeFile: string,
  domain: string
): Promise<WorktreeStatus[]> {
  const worktrees: WorktreeStatus[] = []
  const treesDir = getTreesDir(repoRoot)
  const repoName = sanitizeBranchName(repoRoot.split('/').pop() ?? 'main')

  const mainProjectName = getProjectName(repoRoot, repoName)
  const mainServices = await getWorktreeServiceStatus(
    repoRoot,
    repoName,
    domain,
    repoRoot,
    composeFile,
    mainProjectName
  )

  worktrees.push({
    name: repoName,
    path: repoRoot,
    services: mainServices,
    running: mainServices.some(service => service.running),
  })

  if (!existsSync(treesDir)) {
    return worktrees
  }

  const entries = readdirSync(treesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const worktreePath = join(treesDir, entry.name)
    const projectName = getProjectName(repoRoot, entry.name)
    const services = await getWorktreeServiceStatus(
      repoRoot,
      entry.name,
      domain,
      worktreePath,
      composeFile,
      projectName
    )

    worktrees.push({
      name: entry.name,
      path: worktreePath,
      services,
      running: services.some(service => service.running),
    })
  }

  return worktrees
}

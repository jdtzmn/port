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

/**
 * Get worktree skeletons (names and paths) instantly from the filesystem.
 * No Docker calls — returns empty services arrays that get filled in later.
 */
export function getWorktreeSkeletons(repoRoot: string): WorktreeStatus[] {
  const worktrees: WorktreeStatus[] = []
  const treesDir = getTreesDir(repoRoot)
  const repoName = sanitizeBranchName(repoRoot.split('/').pop() ?? 'main')

  worktrees.push({
    name: repoName,
    path: repoRoot,
    services: [],
    running: false,
  })

  if (!existsSync(treesDir)) {
    return worktrees
  }

  const entries = readdirSync(treesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    worktrees.push({
      name: entry.name,
      path: join(treesDir, entry.name),
      services: [],
      running: false,
    })
  }

  return worktrees
}

/**
 * Fetch service status for a single worktree.
 * Makes Docker CLI calls (compose config + compose ps).
 */
export async function fetchWorktreeServices(
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

/**
 * Collect full worktree statuses (sequential, used by CLI commands).
 * For the TUI, prefer getWorktreeSkeletons + fetchWorktreeServices in parallel.
 */
export async function collectWorktreeStatuses(
  repoRoot: string,
  composeFile: string,
  domain: string
): Promise<WorktreeStatus[]> {
  const skeletons = getWorktreeSkeletons(repoRoot)

  for (const wt of skeletons) {
    const projectName = getProjectName(repoRoot, wt.name)
    const services = await fetchWorktreeServices(
      repoRoot,
      wt.name,
      domain,
      wt.path,
      composeFile,
      projectName
    )
    wt.services = services
    wt.running = services.some(s => s.running)
  }

  return skeletons
}

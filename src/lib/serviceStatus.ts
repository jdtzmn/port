import { loadRegistry } from './registry.ts'
import { getWorktreePath } from './worktree.ts'
import { sanitizeBranchName } from './sanitize.ts'
import { composePs } from './compose.ts'
import { buildProjectName } from './projectName.ts'

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Check whether the current worktree still has running Docker or host services.
 */
export async function branchHasRunningServices(
  repo: string,
  branch: string,
  composeFile: string,
  domain: string
): Promise<boolean> {
  const worktreePath = getWorktreePath(repo, branch)

  try {
    const status = await composePs(worktreePath, composeFile, buildProjectName(repo, branch), {
      repoRoot: repo,
      branch: sanitizeBranchName(branch),
      domain,
    })

    if (status.some(service => service.running)) {
      return true
    }
  } catch {
    // Best effort only.
  }

  const registry = await loadRegistry()
  return (registry.hostServices ?? []).some(
    service => service.repo === repo && service.branch === branch && isProcessRunning(service.pid)
  )
}

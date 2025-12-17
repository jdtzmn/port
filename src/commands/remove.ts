import inquirer from 'inquirer'
import { findGitRoot, worktreeExists, getWorktreePath } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import { removeWorktree } from '../lib/git.ts'
import { unregisterProject, hasRegisteredProjects } from '../lib/registry.ts'
import { composeDown, stopTraefik, isTraefikRunning } from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import * as output from '../lib/output.ts'

/**
 * Remove a worktree and stop its services
 *
 * @param branch - The branch name of the worktree to remove
 */
export async function remove(branch: string): Promise<void> {
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

  // Sanitize branch name
  const sanitized = sanitizeBranchName(branch)

  // Check if worktree exists
  if (!worktreeExists(repoRoot, branch)) {
    output.error(`Worktree not found: ${sanitized}`)
    process.exit(1)
  }

  const worktreePath = getWorktreePath(repoRoot, branch)

  // Load config
  const config = await loadConfig(repoRoot)
  const composeFile = getComposeFile(config)

  // Stop docker-compose services first
  output.info(`Stopping services in ${output.branch(sanitized)}...`)
  try {
    await composeDown(worktreePath, composeFile)
    output.success('Services stopped')
  } catch (error) {
    output.warn(`Failed to stop services: ${error}`)
    // Continue with removal even if stop fails
  }

  // Remove git worktree
  output.info(`Removing worktree: ${output.branch(sanitized)}...`)
  try {
    await removeWorktree(repoRoot, branch, true) // force removal
    output.success('Worktree removed')
  } catch (error) {
    output.error(`Failed to remove worktree: ${error}`)
    process.exit(1)
  }

  // Unregister project from global registry
  await unregisterProject(repoRoot, sanitized)

  // Check if Traefik should be stopped
  const traefikRunning = await isTraefikRunning()
  const hasOtherProjects = await hasRegisteredProjects()

  if (traefikRunning && !hasOtherProjects) {
    output.newline()
    const { stopTraefikConfirm } = await inquirer.prompt<{ stopTraefikConfirm: boolean }>([
      {
        type: 'confirm',
        name: 'stopTraefikConfirm',
        message: 'No other port projects running. Stop Traefik?',
        default: true,
      },
    ])

    if (stopTraefikConfirm) {
      output.info('Stopping Traefik...')
      try {
        await stopTraefik()
        output.success('Traefik stopped')
      } catch (error) {
        output.warn(`Failed to stop Traefik: ${error}`)
      }
    }
  }

  output.newline()
  output.success(`Worktree ${output.branch(sanitized)} removed`)
}

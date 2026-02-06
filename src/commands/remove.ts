import { existsSync } from 'fs'
import inquirer from 'inquirer'
import { detectWorktree, worktreeExists, getWorktreePath } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import {
  findWorktreeByBranch,
  pruneWorktrees,
  removeWorktree,
  removeWorktreeAtPath,
} from '../lib/git.ts'
import { unregisterProject, hasRegisteredProjects } from '../lib/registry.ts'
import { runCompose, stopTraefik, isTraefikRunning, getProjectName } from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import * as output from '../lib/output.ts'
import { failWithError } from '../lib/cli.ts'

interface RemoveOptions {
  force?: boolean
}

/**
 * Remove a worktree and stop its services
 *
 * @param branch - The branch name of the worktree to remove
 */
export async function remove(branch: string, options: RemoveOptions = {}): Promise<void> {
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

  // Sanitize branch name
  const sanitized = sanitizeBranchName(branch)
  const expectedWorktreePath = getWorktreePath(repoRoot, branch)

  let worktreePath = expectedWorktreePath
  let nonStandardWorktree = false

  if (!worktreeExists(repoRoot, branch)) {
    const registeredWorktree = await findWorktreeByBranch(repoRoot, branch)

    if (!registeredWorktree) {
      failWithError(`Worktree not found: ${sanitized}`)
    }

    worktreePath = registeredWorktree.path
    nonStandardWorktree = true

    if (!options.force) {
      output.warn(`Worktree ${output.branch(sanitized)} is registered at a non-standard path:`)
      output.dim(worktreePath)

      const { removeConfirm } = await inquirer.prompt<{ removeConfirm: boolean }>([
        {
          type: 'confirm',
          name: 'removeConfirm',
          message: 'Remove this worktree anyway?',
          default: true,
        },
      ])

      if (!removeConfirm) {
        output.info('Removal cancelled')
        return
      }
    }
  }
  const worktreePathExists = existsSync(worktreePath)

  // Load config
  const config = await loadConfig(repoRoot)
  const composeFile = getComposeFile(config)

  // Stop docker-compose services first
  const projectName = getProjectName(repoRoot, sanitized)
  if (worktreePathExists) {
    output.info(`Stopping services in ${output.branch(sanitized)}...`)
    const { exitCode } = await runCompose(worktreePath, composeFile, projectName, ['down'], {
      repoRoot,
      branch: sanitized,
      domain: config.domain,
    })
    if (exitCode !== 0) {
      output.warn('Failed to stop services')
      // Continue with removal even if stop fails
    } else {
      output.success('Services stopped')
    }
  } else {
    output.warn(`Worktree path missing on disk: ${worktreePath}`)
    output.info('Skipping service shutdown and pruning stale worktree metadata...')
  }

  // Remove git worktree
  output.info(`Removing worktree: ${output.branch(sanitized)}...`)
  try {
    if (worktreePathExists) {
      if (nonStandardWorktree) {
        await removeWorktreeAtPath(repoRoot, worktreePath, true)
      } else {
        await removeWorktree(repoRoot, branch, true)
      }
      output.success('Worktree removed')
    } else {
      await pruneWorktrees(repoRoot)
      output.success('Stale worktree metadata pruned')
    }
  } catch (error) {
    failWithError(`Failed to remove worktree: ${error}`)
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

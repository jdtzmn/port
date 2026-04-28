import inquirer from 'inquirer'
import { detectWorktree, worktreeExists } from '../lib/worktree.ts'
import type { WorktreeInfo } from '../types.ts'
import { loadConfigOrDefault, getComposeFile, ensurePortRuntimeDir } from '../lib/config.ts'
import { findWorktreeByBranch } from '../lib/git.ts'
import { hasRegisteredProjects } from '../lib/registry.ts'
import { stopTraefik, isTraefikRunning, getProjectName } from '../lib/compose.ts'
import { removeWorktreeAndCleanup } from '../lib/removal.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import * as output from '../lib/output.ts'
import { failWithError } from '../lib/cli.ts'
import { exit } from './exit.ts'
import { cleanupDockerResources, scanDockerResourcesForProject } from '../lib/docker-cleanup.ts'

interface RemoveOptions {
  force?: boolean
  keepBranch?: boolean
  cleanupImages?: boolean
}

/**
 * Remove a worktree and stop its services
 *
 * @param branch - The branch name of the worktree to remove (auto-detected when omitted)
 */
export async function remove(
  branch: string | undefined,
  options: RemoveOptions = {}
): Promise<void> {
  let repoRoot: string
  let worktreeInfo: WorktreeInfo
  try {
    worktreeInfo = detectWorktree()
    repoRoot = worktreeInfo.repoRoot
  } catch {
    failWithError('Not in a git repository')
  }

  await ensurePortRuntimeDir(repoRoot)

  // Auto-detect branch from current worktree when not specified
  if (!branch) {
    if (!worktreeInfo.isMainRepo) {
      branch = worktreeInfo.name
    } else if (process.env.PORT_WORKTREE) {
      branch = process.env.PORT_WORKTREE
    } else {
      failWithError('No branch specified and not inside a worktree')
    }

    // Confirm removal when auto-detected
    if (!options.force) {
      const { confirmRemove } = await inquirer.prompt<{ confirmRemove: boolean }>([
        {
          type: 'confirm',
          name: 'confirmRemove',
          message: `Remove worktree ${output.branch(sanitizeBranchName(branch))}?`,
          default: false,
        },
      ])
      if (!confirmRemove) {
        output.info('Removal cancelled')
        return
      }
    }
  }

  // Sanitize branch name
  const sanitized = sanitizeBranchName(branch)

  let nonStandardPath: string | undefined
  let sourceBranch = branch

  if (!worktreeExists(repoRoot, branch)) {
    const registeredWorktree = await findWorktreeByBranch(repoRoot, branch)

    if (!registeredWorktree) {
      failWithError(`Worktree not found: ${sanitized}`)
    }

    nonStandardPath = registeredWorktree.path
    sourceBranch = registeredWorktree.branch

    if (!options.force) {
      output.warn(`Worktree ${output.branch(sanitized)} is registered at a non-standard path:`)
      output.dim(nonStandardPath)

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
  // If the user is currently inside the worktree being removed, exit first
  // This handles both shell-hook usage (PORT_WORKTREE set) and direct cd into the worktree
  const isInsideTargetWorktree =
    process.env.PORT_WORKTREE === sanitized ||
    (!worktreeInfo.isMainRepo && worktreeInfo.name === sanitized)

  if (isInsideTargetWorktree) {
    await exit()
  }

  // Load config (defaults when config file is absent)
  const config = await loadConfigOrDefault(repoRoot)
  const composeFile = getComposeFile(config)

  output.info(`Removing worktree: ${output.branch(sanitized)}...`)

  const result = await removeWorktreeAndCleanup(
    { repoRoot, composeFile, domain: config.domain },
    sourceBranch,
    {
      branchAction: options.keepBranch ? 'keep' : 'archive',
      nonStandardPath,
    }
  )

  if (!result.success) {
    failWithError(result.error ?? 'Failed to remove worktree')
  }

  if (result.archivedBranch) {
    output.info(`Archived local branch as ${output.branch(result.archivedBranch)}`)
  }

  // Docker cleanup integration
  const projectName = getProjectName(repoRoot, sanitized)

  // 1. Always run low-risk cleanup (containers/networks/volumes)
  output.info('Cleaning up Docker resources...')
  const lowRiskCleanup = await cleanupDockerResources(projectName, {
    skipImages: true,
    quiet: false,
  })

  // Display warnings non-fatally
  for (const warning of lowRiskCleanup.warnings) {
    output.warn(warning)
  }

  // Display cleanup results
  if (lowRiskCleanup.dockerAvailable && lowRiskCleanup.totalRemoved > 0) {
    const parts: string[] = []
    if (lowRiskCleanup.containersRemoved > 0) {
      parts.push(`${lowRiskCleanup.containersRemoved} container(s)`)
    }
    if (lowRiskCleanup.volumesRemoved > 0) {
      parts.push(`${lowRiskCleanup.volumesRemoved} volume(s)`)
    }
    if (lowRiskCleanup.networksRemoved > 0) {
      parts.push(`${lowRiskCleanup.networksRemoved} network(s)`)
    }
    output.success(`Cleaned up ${lowRiskCleanup.totalRemoved} resource(s): ${parts.join(', ')}`)
  }

  // 2. Conditional image cleanup (confirm-gated in interactive mode)
  // Scan for images
  const imageResources = await scanDockerResourcesForProject(projectName)

  if (imageResources.images.length > 0) {
    let shouldCleanupImages = false

    // In non-interactive mode or when flag is set, use the flag value
    if (options.cleanupImages !== undefined) {
      shouldCleanupImages = options.cleanupImages
    } else {
      // Interactive mode: prompt with default No
      const sizeStr = imageResources.imageSize
        ? `${(imageResources.imageSize / (1024 * 1024)).toFixed(1)} MB`
        : 'unknown size'

      const { cleanupImages } = await inquirer.prompt<{ cleanupImages: boolean }>([
        {
          type: 'confirm',
          name: 'cleanupImages',
          message: `Clean up ${imageResources.images.length} image(s) (${sizeStr})?`,
          default: false,
        },
      ])
      shouldCleanupImages = cleanupImages
    }

    if (shouldCleanupImages) {
      const imageCleanup = await cleanupDockerResources(projectName, {
        skipImages: false,
        quiet: false,
      })

      for (const warning of imageCleanup.warnings) {
        output.warn(warning)
      }

      if (imageCleanup.imagesRemoved > 0) {
        output.success(`Cleaned up ${imageCleanup.imagesRemoved} image(s)`)
      }
    } else if (options.cleanupImages === undefined) {
      // Only show decline message in interactive mode
      output.info('Image cleanup declined')
    }
  }

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

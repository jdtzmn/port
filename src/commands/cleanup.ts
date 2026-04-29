import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { deleteLocalBranch, listArchivedBranches } from '../lib/git.ts'
import { failWithError } from '../lib/cli.ts'
import { getProjectName } from '../lib/compose.ts'
import { cleanupDockerResources, scanDockerResourcesForProject } from '../lib/docker-cleanup.ts'
import * as output from '../lib/output.ts'

/**
 * Extract sanitized branch name from archived branch name
 * archive/demo-20260206T120000Z -> demo
 */
function extractSanitizedBranchName(archivedBranch: string): string {
  // Remove 'archive/' prefix
  const withoutPrefix = archivedBranch.replace(/^archive\//, '')
  // Remove timestamp suffix (matches -YYYYMMDDTHHmmssZ or -YYYYMMDDTHHmmssZ-N)
  const withoutTimestamp = withoutPrefix.replace(/-\d{8}T\d{6}Z(-\d+)?$/, '')
  return withoutTimestamp
}

interface CleanupOptions {
  cleanupImages?: boolean
}

/**
 * Delete archived local branches created by port remove
 */
export async function cleanup(options: CleanupOptions = {}): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }

  const archivedBranches = await listArchivedBranches(repoRoot)

  if (archivedBranches.length === 0) {
    output.info('No archived branches to clean up.')
    return
  }

  output.header('Archived branches:')
  output.newline()

  for (const branch of archivedBranches) {
    console.log(output.branch(branch))
  }

  output.newline()

  const { confirmCleanup } = await inquirer.prompt<{ confirmCleanup: boolean }>([
    {
      type: 'confirm',
      name: 'confirmCleanup',
      message: `Delete all ${archivedBranches.length} archived branch(es)?`,
      default: false,
    },
  ])

  if (!confirmCleanup) {
    output.info('Cleanup cancelled')
    return
  }

  let deletedCount = 0
  let failedCount = 0
  const successfulBranches: string[] = []

  for (const branch of archivedBranches) {
    try {
      await deleteLocalBranch(repoRoot, branch, true)
      deletedCount += 1
      successfulBranches.push(branch)
      output.success(`Deleted ${output.branch(branch)}`)
    } catch (error) {
      failedCount += 1
      output.warn(`Failed to delete ${output.branch(branch)}: ${error}`)
    }
  }

  output.newline()

  if (failedCount > 0) {
    failWithError(`Deleted ${deletedCount} archived branch(es); ${failedCount} failed.`)
  }

  output.success(`Deleted ${deletedCount} archived branch(es).`)

  // 1. Low-risk cleanup for each archived branch (non-fatal)
  for (const archivedBranch of successfulBranches) {
    const sanitizedName = extractSanitizedBranchName(archivedBranch)
    const projectName = getProjectName(repoRoot, sanitizedName)

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
      if (parts.length > 0) {
        output.success(`Cleaned up ${lowRiskCleanup.totalRemoved} resource(s): ${parts.join(', ')}`)
      }
    }
  }

  // 2. Aggregate image cleanup decision flow
  // Scan all successfully deleted branches for images
  const imageScans = await Promise.all(
    successfulBranches.map(async archivedBranch => {
      const sanitizedName = extractSanitizedBranchName(archivedBranch)
      const projectName = getProjectName(repoRoot, sanitizedName)
      return {
        archivedBranch,
        sanitizedName,
        projectName,
        resources: await scanDockerResourcesForProject(projectName),
      }
    })
  )

  // Filter to branches with images
  const branchesWithImages = imageScans.filter(scan => scan.resources.images.length > 0)

  if (branchesWithImages.length > 0) {
    // Aggregate image stats
    const totalImages = branchesWithImages.reduce(
      (sum, scan) => sum + scan.resources.images.length,
      0
    )

    // Aggregate size (undefined if any project has undefined size)
    const hasUnknownSize = branchesWithImages.some(scan => scan.resources.imageSize === undefined)
    const totalSize = hasUnknownSize
      ? undefined
      : branchesWithImages.reduce((sum, scan) => sum + (scan.resources.imageSize || 0), 0)

    const sizeStr = totalSize ? `${(totalSize / (1024 * 1024)).toFixed(1)} MB` : 'unknown size'

    let shouldCleanupImages = false

    // In non-interactive mode or when flag is set, use the flag value
    if (options.cleanupImages !== undefined) {
      shouldCleanupImages = options.cleanupImages
    } else {
      // Interactive mode: prompt with default No
      // Determine message based on number of projects
      let message: string
      if (branchesWithImages.length === 1) {
        message = `Clean up ${totalImages} image(s) (${sizeStr})?`
      } else {
        message = `Clean up ${totalImages} image(s) across ${branchesWithImages.length} projects (${sizeStr})?`
      }

      output.newline()
      const { cleanupImages } = await inquirer.prompt<{ cleanupImages: boolean }>([
        {
          type: 'confirm',
          name: 'cleanupImages',
          message,
          default: false,
        },
      ])
      shouldCleanupImages = cleanupImages
    }

    if (shouldCleanupImages) {
      // Run image-only cleanup for each branch with images
      for (const scan of branchesWithImages) {
        const imageCleanup = await cleanupDockerResources(scan.projectName, {
          imagesOnly: true,
          quiet: false,
        })

        for (const warning of imageCleanup.warnings) {
          output.warn(warning)
        }

        if (imageCleanup.imagesRemoved > 0) {
          output.success(`Cleaned up ${imageCleanup.imagesRemoved} image(s)`)
        }
      }
    } else if (options.cleanupImages === undefined) {
      // Only show decline message in interactive mode
      output.info('Image cleanup declined')
    }
  }
}

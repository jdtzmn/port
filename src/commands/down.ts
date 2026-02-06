import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import {
  unregisterProject,
  hasRegisteredProjects,
  getHostServicesForWorktree,
  getProjectCount,
} from '../lib/registry.ts'
import { runCompose, stopTraefik, isTraefikRunning, getProjectName } from '../lib/compose.ts'
import { stopHostService } from '../lib/hostService.ts'
import * as output from '../lib/output.ts'

async function stopTraefikGlobally(options?: { yes?: boolean }): Promise<void> {
  const traefikRunning = await isTraefikRunning()

  if (!traefikRunning) {
    output.info('Traefik is not running.')
    return
  }

  const projectCount = await getProjectCount()
  let shouldStopTraefik = options?.yes ?? false

  if (!shouldStopTraefik) {
    output.newline()

    const promptMessage =
      projectCount > 0
        ? `${projectCount} port project(s) still registered. Stop Traefik anyway?`
        : 'Stop Traefik?'

    const { stopTraefikConfirm } = await inquirer.prompt<{ stopTraefikConfirm: boolean }>([
      {
        type: 'confirm',
        name: 'stopTraefikConfirm',
        message: promptMessage,
        default: true,
      },
    ])

    shouldStopTraefik = stopTraefikConfirm
  }

  if (shouldStopTraefik) {
    output.info('Stopping Traefik...')
    try {
      await stopTraefik()
      output.success('Traefik stopped')
    } catch (error) {
      output.warn(`Failed to stop Traefik: ${error}`)
    }
  }
}

/**
 * Stop docker-compose services in the current worktree
 *
 * @param options - Down options (yes to skip confirmation)
 */
export async function down(options?: { yes?: boolean }): Promise<void> {
  // Detect worktree info
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch (error) {
    output.dim(`${error}`)
    output.info('Not in a port-managed worktree. Attempting global Traefik shutdown...')
    await stopTraefikGlobally(options)
    return
  }

  const { repoRoot, worktreePath, name } = worktreeInfo

  // Check if port is initialized
  if (!configExists(repoRoot)) {
    output.info('Port is not initialized in this repository. Attempting global Traefik shutdown...')
    await stopTraefikGlobally(options)
    return
  }

  // Load config
  const config = await loadConfig(repoRoot)
  const composeFile = getComposeFile(config)

  // Stop docker-compose services
  const projectName = getProjectName(repoRoot, name)
  output.info(`Stopping services in ${output.branch(name)}...`)
  const { exitCode } = await runCompose(worktreePath, composeFile, projectName, ['down'], {
    repoRoot,
    branch: name,
    domain: config.domain,
  })
  if (exitCode !== 0) {
    output.error('Failed to stop services')
    // Continue to unregister even if stop fails
  } else {
    output.success('Services stopped')
  }

  // Unregister project from global registry
  await unregisterProject(repoRoot, name)

  // Check for running host services
  const hostServices = await getHostServicesForWorktree(repoRoot, name)

  if (hostServices.length > 0) {
    let shouldStopHostServices = options?.yes ?? false

    if (!shouldStopHostServices) {
      output.newline()
      const { stopHostServicesConfirm } = await inquirer.prompt<{
        stopHostServicesConfirm: boolean
      }>([
        {
          type: 'confirm',
          name: 'stopHostServicesConfirm',
          message: `${hostServices.length} host service(s) running. Stop them too?`,
          default: true,
        },
      ])
      shouldStopHostServices = stopHostServicesConfirm
    }

    if (shouldStopHostServices) {
      for (const svc of hostServices) {
        try {
          await stopHostService(svc)
        } catch (error) {
          output.warn(`Failed to stop host service on port ${svc.logicalPort}: ${error}`)
        }
      }
      output.success(`Stopped ${hostServices.length} host service(s)`)
    }
  }

  // Check if Traefik should be stopped
  const traefikRunning = await isTraefikRunning()
  const hasOtherProjects = await hasRegisteredProjects()

  if (traefikRunning && !hasOtherProjects) {
    let shouldStopTraefik = options?.yes ?? false

    if (!shouldStopTraefik) {
      output.newline()
      const { stopTraefikConfirm } = await inquirer.prompt<{ stopTraefikConfirm: boolean }>([
        {
          type: 'confirm',
          name: 'stopTraefikConfirm',
          message: 'No other port projects running. Stop Traefik?',
          default: true,
        },
      ])
      shouldStopTraefik = stopTraefikConfirm
    }

    if (shouldStopTraefik) {
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
  output.success(`Services stopped in ${output.branch(name)}`)
}

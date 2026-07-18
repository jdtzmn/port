import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, getComposeFile, ensurePortRuntimeDir } from '../lib/config.ts'
import {
  getProject,
  registerProject,
  unregisterProject,
  hasRegisteredProjects,
  getHostServicesForWorktree,
  getProjectCount,
} from '../lib/registry.ts'
import {
  runCompose,
  stopTraefik,
  isTraefikRunning,
  parseComposeFile,
  getServicePorts,
  resolveComposeServices,
} from '../lib/compose.ts'
import { buildProjectName as getProjectName } from '../lib/projectName.ts'
import { execAsync } from '../lib/exec.ts'
import { stopHostService } from '../lib/hostService.ts'
import * as output from '../lib/output.ts'

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b)
}

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
export async function down(
  requestedServicesOrOptions: string[] | { yes?: boolean } = [],
  maybeOptions?: { yes?: boolean }
): Promise<void> {
  const requestedServices = Array.isArray(requestedServicesOrOptions)
    ? requestedServicesOrOptions
    : []
  const options = Array.isArray(requestedServicesOrOptions)
    ? maybeOptions
    : requestedServicesOrOptions

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

  await ensurePortRuntimeDir(repoRoot)

  // Load config (defaults when config file is absent)
  const config = await loadConfigOrDefault(repoRoot)
  const composeFile = getComposeFile(config)
  const selectiveDown = requestedServices.length > 0

  let selectedServices: string[] = []
  let selectedPorts: number[] = []

  if (selectiveDown) {
    try {
      const parsedCompose = await parseComposeFile(worktreePath, composeFile)
      selectedServices = resolveComposeServices(parsedCompose, requestedServices, {
        includeDependencies: false,
      })
      selectedPorts = uniqueNumbers(
        selectedServices.flatMap(serviceName =>
          getServicePorts(parsedCompose.services[serviceName]!)
        )
      )
    } catch (error) {
      output.error(`${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  }

  // Stop docker-compose services
  const projectName = getProjectName(repoRoot, name)
  output.info(`Stopping services in ${output.branch(name)}...`)
  let composeExitCode = 0
  try {
    if (selectiveDown) {
      const containerResult = (await runCompose(
        worktreePath,
        composeFile,
        projectName,
        ['ps', '-q', ...selectedServices],
        {
          repoRoot,
          branch: name,
          domain: config.domain,
        },
        {
          stdio: 'capture',
        }
      )) as { exitCode: number; stdout: string; stderr: string }

      const containerIds = (containerResult.stdout ?? '').trim().split(/\s+/).filter(Boolean)

      if (containerIds.length > 0) {
        await execAsync(`docker rm -f ${containerIds.join(' ')}`)
      }

      composeExitCode = containerResult.exitCode
    } else {
      const { exitCode } = await runCompose(worktreePath, composeFile, projectName, ['down'], {
        repoRoot,
        branch: name,
        domain: config.domain,
      })
      composeExitCode = exitCode
    }
  } catch (error) {
    composeExitCode = 1
    output.warn(`Compose down encountered an error: ${error}`)
  }

  if (composeExitCode !== 0) {
    output.error('Failed to stop services')
    // Continue to unregister even if stop fails
  } else {
    output.success('Services stopped')
  }

  const hostServices = await getHostServicesForWorktree(repoRoot, name)

  if (selectiveDown) {
    const project = await getProject(repoRoot, name)

    if (project) {
      const remainingPorts = project.ports.filter(port => !selectedPorts.includes(port))

      if (remainingPorts.length > 0) {
        await registerProject(repoRoot, name, uniqueNumbers(remainingPorts))
      } else if (hostServices.length > 0) {
        await registerProject(repoRoot, name, [])
      } else {
        await unregisterProject(repoRoot, name)
      }
    }
  } else {
    // Unregister project from global registry
    await unregisterProject(repoRoot, name)
  }

  // Check for running host services
  if (!selectiveDown && hostServices.length > 0) {
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

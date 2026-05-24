import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, getComposeFile, ensurePortRuntimeDir } from '../lib/config.ts'
import {
  unregisterProject,
  hasRegisteredProjects,
  getHostServicesForWorktree,
  getProjectCount,
} from '../lib/registry.ts'
import { runCompose, getProjectName } from '../lib/compose.ts'
import { isSharedStackRunning, stopSharedStack } from '../lib/shared-stack.ts'
import { stopHostService } from '../lib/hostService.ts'
import * as output from '../lib/output.ts'

async function stopSharedStackGlobally(options?: { yes?: boolean }): Promise<void> {
  const sharedStackRunning = await isSharedStackRunning()

  if (!sharedStackRunning) {
    output.info('port proxy is not running.')
    return
  }

  const projectCount = await getProjectCount()
  let shouldStopSharedStack = options?.yes ?? false

  if (!shouldStopSharedStack) {
    output.newline()

    const promptMessage =
      projectCount > 0
        ? `${projectCount} port project(s) still registered. Stop port proxy anyway?`
        : 'Stop port proxy?'

    const { stopSharedStackConfirm } = await inquirer.prompt<{ stopSharedStackConfirm: boolean }>([
      {
        type: 'confirm',
        name: 'stopSharedStackConfirm',
        message: promptMessage,
        default: true,
      },
    ])

    shouldStopSharedStack = stopSharedStackConfirm
  }

  if (shouldStopSharedStack) {
    output.info('Stopping port proxy...')
    try {
      await stopSharedStack()
      output.success('port proxy stopped')
    } catch (error) {
      output.warn(`Failed to stop port proxy: ${error}`)
    }
  }
}

/**
 * Stop docker-compose services in the current worktree
 *
 * @param options - Down options (yes to skip confirmation)
 */
export async function down(options?: { yes?: boolean }): Promise<void> {
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch (error) {
    output.dim(`${error}`)
    output.info('Not in a port-managed worktree. Attempting global Traefik shutdown...')
    await stopSharedStackGlobally(options)
    return
  }

  const { repoRoot, worktreePath, name } = worktreeInfo

  await ensurePortRuntimeDir(repoRoot)

  const config = await loadConfigOrDefault(repoRoot)
  const composeFile = getComposeFile(config)

  const projectName = getProjectName(repoRoot, name)
  output.info(`Stopping services in ${output.branch(name)}...`)
  let composeExitCode = 0
  try {
    const { exitCode } = await runCompose(worktreePath, composeFile, projectName, ['down'], {
      repoRoot,
      branch: name,
      domain: config.domain,
    })
    composeExitCode = exitCode
  } catch (error) {
    composeExitCode = 1
    output.warn(`Compose down encountered an error: ${error}`)
  }

  if (composeExitCode !== 0) {
    output.error('Failed to stop services')
  } else {
    output.success('Services stopped')
  }

  await unregisterProject(repoRoot, name)

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

  const sharedStackRunning = await isSharedStackRunning()
  const hasOtherProjects = await hasRegisteredProjects()

  if (sharedStackRunning && !hasOtherProjects) {
    let shouldStopSharedStack = options?.yes ?? false

    if (!shouldStopSharedStack) {
      output.newline()
      const { stopSharedStackConfirm } = await inquirer.prompt<{ stopSharedStackConfirm: boolean }>(
        [
          {
            type: 'confirm',
            name: 'stopSharedStackConfirm',
            message: 'No other port projects running. Stop port proxy?',
            default: true,
          },
        ]
      )
      shouldStopSharedStack = stopSharedStackConfirm
    }

    if (shouldStopSharedStack) {
      output.info('Stopping port proxy...')
      try {
        await stopSharedStack()
        output.success('port proxy stopped')
      } catch (error) {
        output.warn(`Failed to stop port proxy: ${error}`)
      }
    }
  }

  output.newline()
  output.success(`Services stopped in ${output.branch(name)}`)
}

import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import { unregisterProject, hasRegisteredProjects } from '../lib/registry.ts'
import { runCompose, stopTraefik, isTraefikRunning } from '../lib/compose.ts'
import * as output from '../lib/output.ts'

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
    output.error(`${error}`)
    process.exit(1)
  }

  const { repoRoot, worktreePath, name } = worktreeInfo

  // Check if port is initialized
  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  // Load config
  const config = await loadConfig(repoRoot)
  const composeFile = getComposeFile(config)

  // Stop docker-compose services
  output.info(`Stopping services in ${output.branch(name)}...`)
  const { exitCode } = await runCompose(worktreePath, composeFile, name, ['down'])
  if (exitCode !== 0) {
    output.error('Failed to stop services')
    // Continue to unregister even if stop fails
  } else {
    output.success('Services stopped')
  }

  // Unregister project from global registry
  await unregisterProject(repoRoot, name)

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

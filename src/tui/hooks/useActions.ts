import { useCallback } from 'react'
import type { PortConfig, HostService } from '../../types.ts'
import { getComposeFile } from '../../lib/config.ts'
import {
  runCompose,
  writeOverrideFile,
  startTraefik,
  isTraefikRunning,
  restartTraefik,
  traefikHasRequiredPorts,
  parseComposeFile,
  getAllPorts,
  getProjectName,
  type ComposeCapturedResult,
} from '../../lib/compose.ts'
import { registerProject, unregisterProject } from '../../lib/registry.ts'
import { ensureTraefikPorts, traefikFilesExist, initTraefikFiles } from '../../lib/traefik.ts'
import { stopHostService } from '../../lib/hostService.ts'
import { getHostServicesForWorktree } from '../../lib/registry.ts'
import { removeWorktree } from '../../lib/git.ts'
import { archiveBranch } from '../../lib/git.ts'

export interface ActionResult {
  success: boolean
  message: string
}

export function useActions(repoRoot: string, config: PortConfig, refresh: () => void) {
  const composeFile = getComposeFile(config)

  /**
   * Bring services up for a worktree.
   * Mirrors the logic in commands/up.ts but uses capture mode for stdio.
   */
  const upWorktree = useCallback(
    async (worktreePath: string, worktreeName: string): Promise<ActionResult> => {
      try {
        // Parse compose file
        const parsedCompose = await parseComposeFile(worktreePath, composeFile)
        const ports = getAllPorts(parsedCompose)

        // Ensure Traefik files
        if (!traefikFilesExist()) {
          await initTraefikFiles(ports)
        }
        await ensureTraefikPorts(ports)

        // Ensure Traefik is running
        const traefikRunning = await isTraefikRunning()
        if (!traefikRunning) {
          await startTraefik()
        } else if (!(await traefikHasRequiredPorts(ports))) {
          await restartTraefik()
        }

        const projectName = getProjectName(repoRoot, worktreeName)

        // Write override
        await writeOverrideFile(
          worktreePath,
          parsedCompose,
          worktreeName,
          config.domain,
          projectName
        )

        // Start services (capture mode - don't stomp TUI)
        const result = (await runCompose(
          worktreePath,
          composeFile,
          projectName,
          ['up', '-d'],
          { repoRoot, branch: worktreeName, domain: config.domain },
          { stdio: 'capture' }
        )) as ComposeCapturedResult

        if (result.exitCode !== 0) {
          return { success: false, message: result.stderr || 'Failed to start services' }
        }

        // Register project
        await registerProject(repoRoot, worktreeName, ports)
        refresh()
        return { success: true, message: `Services started in ${worktreeName}` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [repoRoot, config, composeFile, refresh]
  )

  /**
   * Bring services down for a worktree.
   * Mirrors the logic in commands/down.ts but uses capture mode.
   */
  const downWorktree = useCallback(
    async (worktreePath: string, worktreeName: string): Promise<ActionResult> => {
      try {
        const projectName = getProjectName(repoRoot, worktreeName)

        const result = (await runCompose(
          worktreePath,
          composeFile,
          projectName,
          ['down'],
          { repoRoot, branch: worktreeName, domain: config.domain },
          { stdio: 'capture' }
        )) as ComposeCapturedResult

        // Unregister project
        await unregisterProject(repoRoot, worktreeName)

        // Stop host services for this worktree
        const hostServices = await getHostServicesForWorktree(repoRoot, worktreeName)
        for (const svc of hostServices) {
          try {
            await stopHostService(svc)
          } catch {
            // Best effort
          }
        }

        refresh()

        if (result.exitCode !== 0) {
          return { success: false, message: result.stderr || 'Failed to stop services' }
        }

        return { success: true, message: `Services stopped in ${worktreeName}` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [repoRoot, config, composeFile, refresh]
  )

  /**
   * Archive a worktree (stop services, remove worktree, archive branch).
   */
  const archiveWorktree = useCallback(
    async (worktreePath: string, worktreeName: string): Promise<ActionResult> => {
      try {
        // Stop services first
        const projectName = getProjectName(repoRoot, worktreeName)
        await runCompose(
          worktreePath,
          composeFile,
          projectName,
          ['down'],
          { repoRoot, branch: worktreeName, domain: config.domain },
          { stdio: 'capture' }
        )

        await unregisterProject(repoRoot, worktreeName)

        // Stop host services
        const hostServices = await getHostServicesForWorktree(repoRoot, worktreeName)
        for (const svc of hostServices) {
          try {
            await stopHostService(svc)
          } catch {
            // Best effort
          }
        }

        // Remove git worktree
        await removeWorktree(repoRoot, worktreeName, true)

        // Archive branch
        await archiveBranch(repoRoot, worktreeName)

        refresh()
        return { success: true, message: `Worktree ${worktreeName} archived` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [repoRoot, config, composeFile, refresh]
  )

  /**
   * Kill a specific host service.
   */
  const killHostService = useCallback(
    async (service: HostService): Promise<ActionResult> => {
      try {
        await stopHostService(service)
        refresh()
        return { success: true, message: `Stopped host service on port ${service.logicalPort}` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    [refresh]
  )

  return { upWorktree, downWorktree, archiveWorktree, killHostService }
}

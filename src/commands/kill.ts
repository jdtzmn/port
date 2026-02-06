import { detectWorktree } from '../lib/worktree.ts'
import { configExists } from '../lib/config.ts'
import { getHostService, getHostServicesForWorktree } from '../lib/registry.ts'
import { cleanupStaleHostServices, stopHostService } from '../lib/hostService.ts'
import type { HostService } from '../types.ts'
import * as output from '../lib/output.ts'

function parseLogicalPort(portArg: string): number {
  const port = parseInt(portArg, 10)
  if (isNaN(port) || port <= 0 || port > 65535) {
    output.error('Invalid port number. Must be between 1 and 65535.')
    process.exit(1)
  }
  return port
}

/**
 * Stop running host processes started via `port run`
 */
export async function kill(portArg?: string): Promise<void> {
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch (error) {
    output.error(`${error}`)
    process.exit(1)
  }

  const { repoRoot, name: branch } = worktreeInfo

  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  await cleanupStaleHostServices()

  const logicalPort = portArg ? parseLogicalPort(portArg) : undefined
  const services: HostService[] = []

  if (logicalPort) {
    const service = await getHostService(repoRoot, branch, logicalPort)
    if (service) {
      services.push(service)
    }
  } else {
    services.push(...(await getHostServicesForWorktree(repoRoot, branch)))
  }

  if (services.length === 0) {
    if (logicalPort) {
      output.info(`No active host service found for ${branch}:${logicalPort}.`)
    } else {
      output.info(`No active host services found for ${branch}.`)
    }
    return
  }

  let forcedCount = 0
  let failedCount = 0

  for (const service of services) {
    try {
      const result = await stopHostService(service)
      if (result === 'sigkill') {
        forcedCount += 1
        output.warn(`Force killed host service on port ${service.logicalPort}`)
      } else {
        output.success(`Stopped host service on port ${service.logicalPort}`)
      }
    } catch (error) {
      failedCount += 1
      output.warn(`Failed to stop host service on port ${service.logicalPort}: ${error}`)
    }
  }

  if (failedCount > 0) {
    output.error(`Failed to stop ${failedCount} host service(s).`)
    process.exit(1)
  }

  if (forcedCount > 0) {
    output.info(`Stopped ${services.length} host service(s) (${forcedCount} force-killed).`)
  } else {
    output.success(`Stopped ${services.length} host service(s).`)
  }
}

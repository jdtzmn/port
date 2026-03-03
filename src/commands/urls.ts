import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import { parseComposeFile, getServicePorts, composePs, getProjectName } from '../lib/compose.ts'
import * as output from '../lib/output.ts'

/**
 * Show service URLs for the current worktree
 */
export async function urls(serviceName?: string): Promise<void> {
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch {
    output.error('Not in a git repository')
    process.exit(1)
  }

  const { repoRoot, worktreePath, name } = worktreeInfo

  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  const config = await loadConfig(repoRoot)
  const composeFile = getComposeFile(config)

  let parsedCompose
  try {
    parsedCompose = await parseComposeFile(worktreePath, composeFile)
  } catch (error) {
    output.error(`Failed to parse docker-compose file: ${error}`)
    process.exit(1)
  }

  // Query Docker for running container status
  const projectName = getProjectName(repoRoot, name)
  const psResult = await composePs(worktreePath, composeFile, projectName, {
    repoRoot,
    branch: name,
    domain: config.domain,
  })
  const runningServices = new Map(psResult.map(s => [s.name, s.running]))

  const services = Object.entries(parsedCompose.services)
    .map(([service, definition]) => {
      const ports = getServicePorts(definition)
      const running = Array.from(runningServices.entries()).some(
        ([containerName, isRunning]) => containerName.includes(service) && isRunning
      )
      return {
        name: service,
        urls: ports.map(port => `http://${name}.${config.domain}:${port}`),
        running,
      }
    })
    .filter(service => service.urls.length > 0)

  if (serviceName) {
    const selectedService = services.find(service => service.name === serviceName)

    if (!selectedService) {
      output.error(`Service "${serviceName}" not found in current worktree`)
      process.exit(1)
    }

    output.header(`Service URLs for ${output.branch(name)}:`)
    output.serviceUrls([selectedService])
    return
  }

  if (services.length === 0) {
    output.warn('No services with published ports found in current worktree')
    return
  }

  output.header(`Service URLs for ${output.branch(name)}:`)
  output.serviceUrls(services)
}

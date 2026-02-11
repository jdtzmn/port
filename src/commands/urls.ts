import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import { parseComposeFile, getServicePorts } from '../lib/compose.ts'
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

  const services = Object.entries(parsedCompose.services)
    .map(([service, definition]) => {
      const ports = getServicePorts(definition)
      return {
        name: service,
        urls: ports.map(port => `http://${name}.${config.domain}:${port}`),
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

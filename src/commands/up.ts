import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, getComposeFile, ensurePortRuntimeDir } from '../lib/config.ts'
import { registerProject } from '../lib/registry.ts'
import {
  runCompose,
  writeOverrideFile,
  checkComposeVersion,
  parseComposeFile,
  getAllPorts,
  getServicePorts,
  getProjectName,
} from '../lib/compose.ts'
import { prepareSharedStack } from '../lib/shared-stack.ts'
import { checkDns } from '../lib/dns.ts'
import { hookExists, runPostUpHook } from '../lib/hooks.ts'
import * as output from '../lib/output.ts'

/**
 * Start docker-compose services in the current worktree
 */
export async function up(): Promise<void> {
  // Detect worktree info
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch (error) {
    output.error(`${error}`)
    process.exit(1)
  }

  const { repoRoot, worktreePath, name } = worktreeInfo

  await ensurePortRuntimeDir(repoRoot)

  // Check docker-compose version
  const { supported, version } = await checkComposeVersion()
  if (!version) {
    output.error('docker-compose not found. Please install Docker.')
    process.exit(1)
  }
  if (!supported) {
    output.warn(`docker-compose v${version} detected. v2.24.0+ recommended for !override support.`)
  }

  // Load config (defaults when config file is absent)
  const config = await loadConfigOrDefault(repoRoot)
  const composeFile = getComposeFile(config)

  const dnsConfigured = await checkDns(config.domain)
  if (!dnsConfigured) {
    output.warn(`DNS is not configured for *.${config.domain} domains`)
    const installCommand =
      config.domain === 'port' ? "'port install'" : `'port install --domain ${config.domain}'`
    output.info(`Run ${output.command(installCommand)} to set up DNS`)
    process.exit(1)
  }

  // Parse docker-compose file to get services and ports
  output.info('Parsing docker-compose file...')
  let parsedCompose
  try {
    parsedCompose = await parseComposeFile(worktreePath, composeFile)
  } catch (error) {
    output.error(`Failed to parse docker-compose file: ${error}`)
    process.exit(1)
  }

  const ports = getAllPorts(parsedCompose)

  const sharedStackResult = await prepareSharedStack(ports)
  if (sharedStackResult.started) {
    output.success('port proxy started')
  } else if (sharedStackResult.restarted) {
    output.success('port proxy restarted')
  } else if (sharedStackResult.updated) {
    output.info('Updated port proxy configuration')
  }

  const projectName = getProjectName(repoRoot, name)

  // Generate/update override file
  try {
    await writeOverrideFile(worktreePath, parsedCompose, name, config.domain, projectName)
    output.dim('Updated .port/override.yml')
  } catch (error) {
    output.error(`Failed to generate override file: ${error}`)
    process.exit(1)
  }

  // Start docker-compose services
  output.info(`Starting services in ${output.branch(name)}...`)
  const { exitCode } = await runCompose(worktreePath, composeFile, projectName, ['up', '-d'], {
    repoRoot,
    branch: name,
    domain: config.domain,
  })
  if (exitCode !== 0) {
    output.error('Failed to start services')
    process.exit(1)
  }
  output.success('Services started')

  // Register project in global registry
  await registerProject(repoRoot, name, ports)

  // Show success message with URLs
  output.newline()
  output.success(`Services running in ${output.branch(name)}`)

  // Build service URLs from parsed compose file
  const serviceUrls: Array<{ name: string; urls: string[] }> = []
  for (const [serviceName, service] of Object.entries(parsedCompose.services)) {
    const servicePorts = getServicePorts(service)
    if (servicePorts.length > 0) {
      const urls = servicePorts.map(port => `http://${name}.${config.domain}:${port}`)
      serviceUrls.push({ name: serviceName, urls })
    }
  }
  output.serviceUrls(serviceUrls)

  output.newline()
  output.info(`Traefik dashboard: ${output.url('http://localhost:1211')}`)

  if (await hookExists(repoRoot, 'post-up')) {
    output.newline()
    output.info('Running post-up hook...')

    const result = await runPostUpHook({
      repoRoot,
      worktreePath,
      branch: name,
      domain: config.domain,
    })

    if (!result.success) {
      output.warn(`Post-up hook failed (exit code ${result.exitCode})`)
      output.dim('See .port/logs/latest.log for details')
      return
    }

    output.success('Post-up hook completed')
  }
}

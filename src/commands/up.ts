import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists, getComposeFile } from '../lib/config.ts'
import { registerProject } from '../lib/registry.ts'
import { ensureTraefikPorts, traefikFilesExist, initTraefikFiles } from '../lib/traefik.ts'
import {
  runCompose,
  writeOverrideFile,
  startTraefik,
  isTraefikRunning,
  restartTraefik,
  checkComposeVersion,
  parseComposeFile,
  getAllPorts,
  getServicePorts,
  getProjectName,
} from '../lib/compose.ts'
import { checkDns } from '../lib/dns.ts'
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

  // Check if port is initialized
  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  // Check docker-compose version
  const { supported, version } = await checkComposeVersion()
  if (!version) {
    output.error('docker-compose not found. Please install Docker.')
    process.exit(1)
  }
  if (!supported) {
    output.warn(`docker-compose v${version} detected. v2.24.0+ recommended for !override support.`)
  }

  // Load config
  const config = await loadConfig(repoRoot)
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

  // Ensure Traefik files exist
  if (!traefikFilesExist()) {
    output.info('Initializing Traefik configuration...')
    await initTraefikFiles(ports)
    output.success('Traefik configuration created')
  }

  // Ensure all required ports are configured in Traefik
  const configUpdated = await ensureTraefikPorts(ports)
  if (configUpdated) {
    output.info('Updated Traefik configuration with new ports')
  }

  // Check if Traefik is running
  const traefikRunning = await isTraefikRunning()

  if (!traefikRunning) {
    output.info('Starting Traefik...')
    try {
      await startTraefik()
      output.success('Traefik started')
    } catch (error) {
      output.error(`Failed to start Traefik: ${error}`)
      process.exit(1)
    }
  } else if (configUpdated) {
    // Restart Traefik if config was updated
    output.info('Restarting Traefik with new configuration...')
    try {
      await restartTraefik()
      output.success('Traefik restarted')
    } catch (error) {
      output.warn(`Failed to restart Traefik: ${error}`)
    }
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
}

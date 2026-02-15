import inquirer from 'inquirer'
import {
  checkDns,
  getDnsSetupInstructions,
  isValidIp,
  isSystemdResolvedRunning,
  isPortInUse,
  DEFAULT_DNS_IP,
  DEFAULT_DOMAIN,
  DNSMASQ_ALT_PORT,
} from '../lib/dns.ts'
import { detectWorktree } from '../lib/worktree.ts'
import { configExists, loadConfig } from '../lib/config.ts'
import * as output from '../lib/output.ts'
import { execAsync } from '../lib/exec.ts'

/**
 * Check if a command exists
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`which ${cmd}`)
    return true
  } catch {
    return false
  }
}

/**
 * Check if running inside a Docker container
 */
async function isRunningInDocker(): Promise<boolean> {
  try {
    await execAsync('test -f /.dockerenv')
    return true
  } catch {
    return false
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase()
}

async function resolveInstallDomain(explicitDomain?: string): Promise<string> {
  if (explicitDomain !== undefined) {
    const normalized = normalizeDomain(explicitDomain)
    if (!normalized) {
      output.error('Domain must be a non-empty string.')
      process.exit(1)
    }
    return normalized
  }

  try {
    const { repoRoot } = detectWorktree()
    if (configExists(repoRoot)) {
      const config = await loadConfig(repoRoot)
      return normalizeDomain(config.domain)
    }
  } catch {
    // Outside a repository (or not in git), fall back to default domain.
  }

  return DEFAULT_DOMAIN
}

/**
 * Install and configure DNS for wildcard domains on macOS
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 * @param domain - The domain suffix to configure (e.g., 'port', 'custom')
 */
async function installMacOS(dnsIp: string, domain: string): Promise<boolean> {
  // Check if Homebrew is installed
  if (!(await commandExists('brew'))) {
    output.error('Homebrew is required but not installed.')
    output.info('Install Homebrew from https://brew.sh')
    return false
  }

  // Check if dnsmasq is installed
  const dnsmasqInstalled = await commandExists('dnsmasq')

  if (!dnsmasqInstalled) {
    output.info('Installing dnsmasq via Homebrew...')
    try {
      await execAsync('brew install dnsmasq')
      output.success('dnsmasq installed')
    } catch (error) {
      output.error(`Failed to install dnsmasq: ${error}`)
      return false
    }
  } else {
    output.dim('dnsmasq already installed')
  }

  // Determine Homebrew prefix (Intel vs Apple Silicon)
  let brewPrefix: string
  try {
    const { stdout } = await execAsync('brew --prefix')
    brewPrefix = stdout.trim()
  } catch {
    brewPrefix = '/opt/homebrew' // Default for Apple Silicon
  }

  const dnsmasqConf = `${brewPrefix}/etc/dnsmasq.conf`

  // Check if already configured
  try {
    const { stdout } = await execAsync(
      `grep -q "address=/${domain}/${dnsIp}" ${dnsmasqConf} && echo "found"`
    )
    if (stdout.trim() === 'found') {
      output.dim(`dnsmasq already configured for .${domain} domain`)
    }
  } catch {
    // Not configured yet, add it
    output.info(`Configuring dnsmasq for .${domain} domain...`)
    try {
      await execAsync(`echo "address=/${domain}/${dnsIp}" >> ${dnsmasqConf}`)
      output.success('dnsmasq configured')
    } catch (error) {
      output.error(`Failed to configure dnsmasq: ${error}`)
      return false
    }
  }

  // Set up resolver first — this is what makes macOS dscacheutil (and
  // therefore checkDns / `port up`) work.  Without /etc/resolver/<domain>,
  // DNS resolution for *.<domain> won't use dnsmasq at all, even if the
  // service is running correctly.
  let resolverOk = true
  try {
    // Check if /etc/resolver already contains the correct config
    const { stdout } = await execAsync(`cat /etc/resolver/${domain} 2>/dev/null`)
    if (stdout.includes(`nameserver ${dnsIp}`)) {
      output.dim(`Resolver already configured at /etc/resolver/${domain}`)
    } else {
      // File exists but has wrong content — overwrite it
      await execAsync(`echo "nameserver ${dnsIp}" | sudo tee /etc/resolver/${domain} > /dev/null`)
      output.success(`Resolver updated at /etc/resolver/${domain}`)
    }
  } catch {
    // File doesn't exist or can't be read — create it
    output.info(`Creating resolver for .${domain} domain...`)
    try {
      await execAsync('sudo mkdir -p /etc/resolver')
      await execAsync(`echo "nameserver ${dnsIp}" | sudo tee /etc/resolver/${domain} > /dev/null`)
      output.success(`Resolver created at /etc/resolver/${domain}`)
    } catch (error) {
      output.error(`Failed to create resolver: ${error}`)
      output.info('You can try running these commands manually:')
      output.info('  sudo mkdir -p /etc/resolver')
      output.info(`  echo "nameserver ${dnsIp}" | sudo tee /etc/resolver/${domain}`)
      resolverOk = false
    }
  }

  // Start or restart dnsmasq so it picks up any config changes
  let serviceOk = true
  let dnsmasqRunning = false
  try {
    await execAsync('pgrep dnsmasq')
    dnsmasqRunning = true
  } catch {
    // pgrep returns non-zero if no process found
  }

  const serviceCommand = dnsmasqRunning
    ? 'sudo brew services restart dnsmasq'
    : 'sudo brew services start dnsmasq'

  if (dnsmasqRunning) {
    output.info('Reloading dnsmasq service...')
  } else {
    output.info('Starting dnsmasq service...')
  }

  try {
    await execAsync(serviceCommand)
    output.success(dnsmasqRunning ? 'dnsmasq service reloaded' : 'dnsmasq service started')
  } catch (error) {
    output.error(`Failed to ${dnsmasqRunning ? 'reload' : 'start'} dnsmasq: ${error}`)
    output.info('Run this command as an admin user:')
    output.info(`  ${serviceCommand}`)
    serviceOk = false
  }

  return resolverOk && serviceOk
}

/**
 * Print manual instructions as fallback when automatic setup fails
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
function printLinuxManualInstructions(dnsIp: string, domain: string): boolean {
  output.warn('Automatic setup failed. Please configure manually:')
  output.newline()

  const { instructions } = getDnsSetupInstructions(dnsIp, domain)
  for (const line of instructions) {
    console.log(line)
  }

  output.newline()
  output.info('After completing the setup, run "port install" again to verify.')

  return false
}

/**
 * Install Linux in dual-mode: dnsmasq on port 5354 + systemd-resolved forwarding
 * Used when systemd-resolved is already running on port 53
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
async function installLinuxDualMode(dnsIp: string, domain: string): Promise<boolean> {
  // 1. Check/install dnsmasq
  if (!(await commandExists('dnsmasq'))) {
    output.info('Installing dnsmasq...')
    try {
      await execAsync('sudo apt-get update && sudo apt-get install -y dnsmasq')
      output.success('dnsmasq installed')
    } catch (error) {
      output.error(`Failed to install dnsmasq: ${error}`)
      return printLinuxManualInstructions(dnsIp, domain)
    }
  } else {
    output.dim('dnsmasq already installed')
  }

  // Check if running in Docker (affects DNS configuration)
  const inDocker = await isRunningInDocker()

  // 2. Configure dnsmasq on port 5354
  output.info(`Configuring dnsmasq on port ${DNSMASQ_ALT_PORT}...`)
  try {
    await execAsync('sudo mkdir -p /etc/dnsmasq.d/')
    await execAsync(
      `echo "port=${DNSMASQ_ALT_PORT}" | sudo tee /etc/dnsmasq.d/${domain}.conf > /dev/null`
    )
    await execAsync(
      `echo "address=/${domain}/${dnsIp}" | sudo tee -a /etc/dnsmasq.d/${domain}.conf > /dev/null`
    )

    // If running in Docker, configure dnsmasq to forward non-.port queries to Docker's DNS
    if (inDocker) {
      await execAsync(
        `echo "server=127.0.0.11" | sudo tee -a /etc/dnsmasq.d/${domain}.conf > /dev/null`
      )
      output.dim('Added Docker DNS (127.0.0.11) as upstream server')
    }

    output.success('dnsmasq configured')
  } catch (error) {
    output.error(`Failed to configure dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp, domain)
  }

  // 3. Restart dnsmasq via systemctl (will use port 5354 from config)
  output.info('Restarting dnsmasq...')
  try {
    await execAsync('sudo systemctl restart dnsmasq')
    output.success(`dnsmasq restarted on port ${DNSMASQ_ALT_PORT}`)
  } catch (error) {
    output.error(`Failed to restart dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp, domain)
  }

  // 4. Configure systemd-resolved to use dnsmasq
  output.info('Configuring systemd-resolved...')
  try {
    await execAsync('sudo mkdir -p /etc/systemd/resolved.conf.d/')
    await execAsync(
      `echo "[Resolve]" | sudo tee /etc/systemd/resolved.conf.d/${domain}.conf > /dev/null`
    )
    await execAsync(
      `echo "DNS=127.0.0.1:${DNSMASQ_ALT_PORT}" | sudo tee -a /etc/systemd/resolved.conf.d/${domain}.conf > /dev/null`
    )

    // For non-Docker Linux, use routing domain so systemd-resolved
    // only sends wildcard-domain queries to dnsmasq (keeps default DNS for other queries)
    if (!inDocker) {
      await execAsync(
        `echo "Domains=~${domain}" | sudo tee -a /etc/systemd/resolved.conf.d/${domain}.conf > /dev/null`
      )
    }

    await execAsync('sudo systemctl restart systemd-resolved')
    output.success('systemd-resolved configured')
  } catch (error) {
    output.error(`Failed to configure systemd-resolved: ${error}`)
    return printLinuxManualInstructions(dnsIp, domain)
  }

  return true
}

/**
 * Install Linux in standalone mode: dnsmasq on port 53
 * Used when systemd-resolved is NOT running
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
async function installLinuxStandalone(dnsIp: string, domain: string): Promise<boolean> {
  // 1. Check/install dnsmasq
  if (!(await commandExists('dnsmasq'))) {
    output.info('Installing dnsmasq...')
    try {
      await execAsync('sudo apt-get update && sudo apt-get install -y dnsmasq')
      output.success('dnsmasq installed')
    } catch (error) {
      output.error(`Failed to install dnsmasq: ${error}`)
      return printLinuxManualInstructions(dnsIp, domain)
    }
  } else {
    output.dim('dnsmasq already installed')
  }

  // 2. Configure dnsmasq on port 53 (standard)
  output.info('Configuring dnsmasq...')
  try {
    await execAsync('sudo mkdir -p /etc/dnsmasq.d/')
    await execAsync(
      `echo "address=/${domain}/${dnsIp}" | sudo tee /etc/dnsmasq.d/${domain}.conf > /dev/null`
    )
    output.success('dnsmasq configured')
  } catch (error) {
    output.error(`Failed to configure dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp, domain)
  }

  // 3. Restart dnsmasq service
  output.info('Restarting dnsmasq...')
  try {
    await execAsync('sudo systemctl restart dnsmasq')
    output.success('dnsmasq restarted')
  } catch (error) {
    output.error(`Failed to restart dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp, domain)
  }

  return true
}

/**
 * Install and configure DNS for wildcard domains on Linux
 * Detects systemd-resolved and chooses the appropriate mode
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
async function installLinux(dnsIp: string, domain: string): Promise<boolean> {
  const systemdResolvedActive = await isSystemdResolvedRunning()
  const port53InUse = await isPortInUse(53)

  if (systemdResolvedActive && port53InUse) {
    output.info('Detected systemd-resolved running on port 53')
    output.info(
      `Using dual-mode: dnsmasq on port ${DNSMASQ_ALT_PORT} + systemd-resolved forwarding`
    )
    output.newline()
    return await installLinuxDualMode(dnsIp, domain)
  } else {
    output.info('Using standalone mode: dnsmasq on port 53')
    output.newline()
    return await installLinuxStandalone(dnsIp, domain)
  }
}

/**
 * Install DNS configuration for wildcard domains
 *
 * @param options - Install options (yes, dnsIp)
 */
export async function install(options?: {
  yes?: boolean
  dnsIp?: string
  domain?: string
}): Promise<void> {
  // Validate DNS IP if provided
  const dnsIp = options?.dnsIp ?? DEFAULT_DNS_IP

  if (!isValidIp(dnsIp)) {
    output.error(`Invalid IP address: ${dnsIp}`)
    output.info('Please provide a valid IPv4 address (e.g., 127.0.0.1 or 192.168.1.1)')
    process.exit(1)
  }

  const domain = await resolveInstallDomain(options?.domain)

  // First check if DNS is already configured
  output.info('Checking DNS configuration...')
  const alreadyConfigured = await checkDns(domain, dnsIp)

  if (alreadyConfigured) {
    output.success(`DNS is already configured for *.${domain} domains (${dnsIp})`)
    output.dim('No changes needed')
    return
  }

  // Get platform-specific instructions
  const { platform } = getDnsSetupInstructions(dnsIp, domain)

  if (platform === 'unsupported') {
    output.error('Your platform is not directly supported.')
    output.info(`Configure your DNS to resolve *.${domain} to ${dnsIp}`)
    process.exit(1)
  }

  // Confirm with user (skip if -y flag is provided)
  if (!options?.yes) {
    output.newline()
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Configure DNS to resolve *.${domain} to ${dnsIp}?`,
        default: true,
      },
    ])

    if (!confirm) {
      output.dim('DNS setup cancelled')
      return
    }
  }

  output.newline()

  let success = false

  if (platform === 'macos') {
    success = await installMacOS(dnsIp, domain)
  } else if (platform === 'linux') {
    success = await installLinux(dnsIp, domain)
  }

  if (!success) {
    output.newline()
    output.warn('DNS setup incomplete')
    return
  }

  // Verify DNS is working
  output.newline()
  output.info('Verifying DNS configuration...')

  // Wait a moment for DNS to propagate
  await new Promise(resolve => setTimeout(resolve, 2000))

  const verified = await checkDns(domain, dnsIp)

  if (verified) {
    output.success('DNS configured successfully!')
    output.info(`Test with: ${output.command(`ping test.${domain}`)}`)
  } else {
    output.warn('DNS verification failed')
    output.info('DNS changes may take a moment to propagate. Try again in a few seconds.')
    output.info(`Test manually with: ${output.command(`dig test.${domain}`)}`)
  }
}

import { exec } from 'child_process'
import { promisify } from 'util'
import inquirer from 'inquirer'
import {
  checkDns,
  getDnsSetupInstructions,
  isValidIp,
  isSystemdResolvedRunning,
  isPortInUse,
  DEFAULT_DNS_IP,
  DNSMASQ_ALT_PORT,
} from '../lib/dns.ts'
import * as output from '../lib/output.ts'

const execAsync = promisify(exec)

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
 * Install and configure DNS for *.port domains on macOS
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
async function installMacOS(dnsIp: string): Promise<boolean> {
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
      `grep -q "address=/port/${dnsIp}" ${dnsmasqConf} && echo "found"`
    )
    if (stdout.trim() === 'found') {
      output.dim('dnsmasq already configured for .port domain')
    }
  } catch {
    // Not configured yet, add it
    output.info('Configuring dnsmasq for .port domain...')
    try {
      await execAsync(`echo "address=/port/${dnsIp}" >> ${dnsmasqConf}`)
      output.success('dnsmasq configured')
    } catch (error) {
      output.error(`Failed to configure dnsmasq: ${error}`)
      return false
    }
  }

  // Check if dnsmasq is already running
  let dnsmasqRunning = false
  try {
    await execAsync('pgrep dnsmasq')
    dnsmasqRunning = true
  } catch {
    // pgrep returns non-zero if no process found
  }

  if (dnsmasqRunning) {
    output.dim('dnsmasq service already running')
  } else {
    // Start dnsmasq service
    output.info('Starting dnsmasq service...')
    try {
      await execAsync('sudo brew services restart dnsmasq')
      output.success('dnsmasq service started')
    } catch (error) {
      output.error(`Failed to start dnsmasq: ${error}`)
      output.info('You can try running this command manually:')
      output.info('  sudo brew services start dnsmasq')
      return false
    }
  }

  // Check if resolver is already configured
  let resolverConfigured = false
  try {
    // Check if /etc/resolver exists and contains the correct config
    const { stdout } = await execAsync('cat /etc/resolver/port 2>/dev/null')
    if (stdout.includes(`nameserver ${dnsIp}`)) {
      resolverConfigured = true
    }
  } catch {
    // File doesn't exist or can't be read
  }

  if (resolverConfigured) {
    output.dim('Resolver already configured at /etc/resolver/port')
  } else {
    // Create resolver directory and file
    output.info('Creating resolver for .port domain...')
    try {
      await execAsync('sudo mkdir -p /etc/resolver')
      await execAsync(`echo "nameserver ${dnsIp}" | sudo tee /etc/resolver/port > /dev/null`)
      output.success('Resolver created at /etc/resolver/port')
    } catch (error) {
      output.error(`Failed to create resolver: ${error}`)
      output.info('You can try running these commands manually:')
      output.info('  sudo mkdir -p /etc/resolver')
      output.info(`  echo "nameserver ${dnsIp}" | sudo tee /etc/resolver/port`)
      return false
    }
  }

  return true
}

/**
 * Print manual instructions as fallback when automatic setup fails
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
function printLinuxManualInstructions(dnsIp: string): boolean {
  output.warn('Automatic setup failed. Please configure manually:')
  output.newline()

  const { instructions } = getDnsSetupInstructions(dnsIp)
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
async function installLinuxDualMode(dnsIp: string): Promise<boolean> {
  // 1. Check/install dnsmasq
  if (!(await commandExists('dnsmasq'))) {
    output.info('Installing dnsmasq...')
    try {
      await execAsync('sudo apt-get update && sudo apt-get install -y dnsmasq')
      output.success('dnsmasq installed')
    } catch (error) {
      output.error(`Failed to install dnsmasq: ${error}`)
      return printLinuxManualInstructions(dnsIp)
    }
  } else {
    output.dim('dnsmasq already installed')
  }

  // 2. Configure dnsmasq on port 5354
  output.info(`Configuring dnsmasq on port ${DNSMASQ_ALT_PORT}...`)
  try {
    await execAsync('sudo mkdir -p /etc/dnsmasq.d/')
    await execAsync(
      `echo -e "port=${DNSMASQ_ALT_PORT}\\naddress=/port/${dnsIp}" | sudo tee /etc/dnsmasq.d/port.conf > /dev/null`
    )
    output.success('dnsmasq configured')
  } catch (error) {
    output.error(`Failed to configure dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp)
  }

  // 3. Restart dnsmasq via systemctl (will use port 5354 from config)
  output.info('Restarting dnsmasq...')
  try {
    await execAsync('sudo systemctl restart dnsmasq')
    output.success(`dnsmasq restarted on port ${DNSMASQ_ALT_PORT}`)
  } catch (error) {
    output.error(`Failed to restart dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp)
  }

  // 4. Configure systemd-resolved to forward *.port queries
  output.info('Configuring systemd-resolved forwarding...')
  try {
    await execAsync('sudo mkdir -p /etc/systemd/resolved.conf.d/')
    await execAsync(
      `echo -e "[Resolve]\\nDNS=127.0.0.1:${DNSMASQ_ALT_PORT}\\nDomains=~port" | sudo tee /etc/systemd/resolved.conf.d/port.conf > /dev/null`
    )
    await execAsync('sudo systemctl restart systemd-resolved')
    output.success('systemd-resolved configured')
  } catch (error) {
    output.error(`Failed to configure systemd-resolved: ${error}`)
    return printLinuxManualInstructions(dnsIp)
  }

  return true
}

/**
 * Install Linux in standalone mode: dnsmasq on port 53
 * Used when systemd-resolved is NOT running
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
async function installLinuxStandalone(dnsIp: string): Promise<boolean> {
  // 1. Check/install dnsmasq
  if (!(await commandExists('dnsmasq'))) {
    output.info('Installing dnsmasq...')
    try {
      await execAsync('sudo apt-get update && sudo apt-get install -y dnsmasq')
      output.success('dnsmasq installed')
    } catch (error) {
      output.error(`Failed to install dnsmasq: ${error}`)
      return printLinuxManualInstructions(dnsIp)
    }
  } else {
    output.dim('dnsmasq already installed')
  }

  // 2. Configure dnsmasq on port 53 (standard)
  output.info('Configuring dnsmasq...')
  try {
    await execAsync('sudo mkdir -p /etc/dnsmasq.d/')
    await execAsync(`echo "address=/port/${dnsIp}" | sudo tee /etc/dnsmasq.d/port.conf > /dev/null`)
    output.success('dnsmasq configured')
  } catch (error) {
    output.error(`Failed to configure dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp)
  }

  // 3. Restart dnsmasq service
  output.info('Restarting dnsmasq...')
  try {
    await execAsync('sudo systemctl restart dnsmasq')
    output.success('dnsmasq restarted')
  } catch (error) {
    output.error(`Failed to restart dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp)
  }

  return true
}

/**
 * Install and configure DNS for *.port domains on Linux
 * Detects systemd-resolved and chooses the appropriate mode
 *
 * @param dnsIp - The IP address to configure DNS to resolve to
 */
async function installLinux(dnsIp: string): Promise<boolean> {
  const systemdResolvedActive = await isSystemdResolvedRunning()
  const port53InUse = await isPortInUse(53)

  if (systemdResolvedActive && port53InUse) {
    output.info('Detected systemd-resolved running on port 53')
    output.info(
      `Using dual-mode: dnsmasq on port ${DNSMASQ_ALT_PORT} + systemd-resolved forwarding`
    )
    output.newline()
    return await installLinuxDualMode(dnsIp)
  } else {
    output.info('Using standalone mode: dnsmasq on port 53')
    output.newline()
    return await installLinuxStandalone(dnsIp)
  }
}

/**
 * Install DNS configuration for *.port domains
 *
 * @param options - Install options (yes, dnsIp)
 */
export async function install(options?: { yes?: boolean; dnsIp?: string }): Promise<void> {
  // Validate DNS IP if provided
  const dnsIp = options?.dnsIp ?? DEFAULT_DNS_IP

  if (!isValidIp(dnsIp)) {
    output.error(`Invalid IP address: ${dnsIp}`)
    output.info('Please provide a valid IPv4 address (e.g., 127.0.0.1 or 192.168.1.1)')
    process.exit(1)
  }

  // First check if DNS is already configured
  output.info('Checking DNS configuration...')
  const alreadyConfigured = await checkDns('port', dnsIp)

  if (alreadyConfigured) {
    output.success(`DNS is already configured for *.port domains (${dnsIp})`)
    output.dim('No changes needed')
    return
  }

  // Get platform-specific instructions
  const { platform } = getDnsSetupInstructions(dnsIp)

  if (platform === 'unsupported') {
    output.error('Your platform is not directly supported.')
    output.info(`Configure your DNS to resolve *.port to ${dnsIp}`)
    process.exit(1)
  }

  // Confirm with user (skip if -y flag is provided)
  if (!options?.yes) {
    output.newline()
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Configure DNS to resolve *.port to ${dnsIp}?`,
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
    success = await installMacOS(dnsIp)
  } else if (platform === 'linux') {
    success = await installLinux(dnsIp)
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

  const verified = await checkDns('port', dnsIp)

  if (verified) {
    output.success('DNS configured successfully!')
    output.info(`Test with: ${output.command('ping test.port')}`)
  } else {
    output.warn('DNS verification failed')
    output.info('DNS changes may take a moment to propagate. Try again in a few seconds.')
    output.info(`Test manually with: ${output.command('dig test.port')}`)
  }
}

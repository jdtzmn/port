import { exec } from 'child_process'
import { promisify } from 'util'
import inquirer from 'inquirer'
import { checkDns, isSystemdResolvedRunning, DEFAULT_DNS_IP } from '../lib/dns.ts'
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
 * Check if dnsmasq is running
 */
async function isDnsmasqRunning(): Promise<boolean> {
  try {
    await execAsync('pgrep dnsmasq')
    return true
  } catch {
    return false
  }
}

/**
 * Uninstall DNS configuration for *.port domains on macOS
 */
async function uninstallMacOS(): Promise<boolean> {
  // Determine Homebrew prefix (Intel vs Apple Silicon)
  let brewPrefix: string
  try {
    const { stdout } = await execAsync('brew --prefix')
    brewPrefix = stdout.trim()
  } catch {
    brewPrefix = '/opt/homebrew' // Default for Apple Silicon
  }

  const dnsmasqConf = `${brewPrefix}/etc/dnsmasq.conf`

  // Remove the .port configuration from dnsmasq.conf
  output.info('Removing .port configuration from dnsmasq...')
  try {
    // Check if dnsmasq.conf exists and has our config
    const { stdout } = await execAsync(`grep "address=/port/" ${dnsmasqConf} 2>/dev/null || true`)
    if (stdout.trim()) {
      // Remove lines containing address=/port/
      await execAsync(`sudo sed -i '' '/address=\\/port\\//d' ${dnsmasqConf}`)
      output.success('Removed .port configuration from dnsmasq.conf')
    } else {
      output.dim('No .port configuration found in dnsmasq.conf')
    }
  } catch (error) {
    output.warn(`Could not modify dnsmasq.conf: ${error}`)
  }

  // Remove the resolver file
  output.info('Removing resolver for .port domain...')
  try {
    await execAsync('test -f /etc/resolver/port')
    await execAsync('sudo rm /etc/resolver/port')
    output.success('Removed /etc/resolver/port')
  } catch {
    output.dim('No resolver file found at /etc/resolver/port')
  }

  // Restart dnsmasq if it's running (to apply the config changes)
  if (await isDnsmasqRunning()) {
    output.info('Restarting dnsmasq to apply changes...')
    try {
      await execAsync('sudo brew services restart dnsmasq')
      output.success('dnsmasq restarted')
    } catch (error) {
      output.warn(`Could not restart dnsmasq: ${error}`)
    }
  }

  return true
}

/**
 * Uninstall DNS configuration for *.port domains on Linux (dual-mode)
 * Removes dnsmasq config on port 5354 and systemd-resolved forwarding
 */
async function uninstallLinuxDualMode(): Promise<boolean> {
  // Remove dnsmasq configuration
  output.info('Removing dnsmasq configuration...')
  try {
    await execAsync('test -f /etc/dnsmasq.d/port.conf')
    await execAsync('sudo rm /etc/dnsmasq.d/port.conf')
    output.success('Removed /etc/dnsmasq.d/port.conf')
  } catch {
    output.dim('No dnsmasq configuration found at /etc/dnsmasq.d/port.conf')
  }

  // Restart dnsmasq if it's running
  if (await commandExists('dnsmasq')) {
    try {
      await execAsync('systemctl is-active dnsmasq')
      output.info('Restarting dnsmasq...')
      await execAsync('sudo systemctl restart dnsmasq')
      output.success('dnsmasq restarted')
    } catch {
      output.dim('dnsmasq service is not running')
    }
  }

  // Remove systemd-resolved configuration
  output.info('Removing systemd-resolved configuration...')
  try {
    await execAsync('test -f /etc/systemd/resolved.conf.d/port.conf')
    await execAsync('sudo rm /etc/systemd/resolved.conf.d/port.conf')
    output.success('Removed /etc/systemd/resolved.conf.d/port.conf')

    // Restart systemd-resolved to apply changes
    output.info('Restarting systemd-resolved...')
    await execAsync('sudo systemctl restart systemd-resolved')
    output.success('systemd-resolved restarted')
  } catch {
    output.dim('No systemd-resolved configuration found at /etc/systemd/resolved.conf.d/port.conf')
  }

  return true
}

/**
 * Uninstall DNS configuration for *.port domains on Linux (standalone mode)
 * Removes dnsmasq config on port 53
 */
async function uninstallLinuxStandalone(): Promise<boolean> {
  // Remove dnsmasq configuration
  output.info('Removing dnsmasq configuration...')
  try {
    await execAsync('test -f /etc/dnsmasq.d/port.conf')
    await execAsync('sudo rm /etc/dnsmasq.d/port.conf')
    output.success('Removed /etc/dnsmasq.d/port.conf')
  } catch {
    output.dim('No dnsmasq configuration found at /etc/dnsmasq.d/port.conf')
  }

  // Restart dnsmasq if it's running
  if (await commandExists('dnsmasq')) {
    try {
      await execAsync('systemctl is-active dnsmasq')
      output.info('Restarting dnsmasq...')
      await execAsync('sudo systemctl restart dnsmasq')
      output.success('dnsmasq restarted')
    } catch {
      output.dim('dnsmasq service is not running')
    }
  }

  return true
}

/**
 * Uninstall DNS configuration for *.port domains on Linux
 * Detects the mode (dual or standalone) and removes the appropriate configuration
 */
async function uninstallLinux(): Promise<boolean> {
  const systemdResolvedActive = await isSystemdResolvedRunning()

  // Check if we have systemd-resolved config (indicates dual-mode was used)
  let hasDualModeConfig = false
  try {
    await execAsync('test -f /etc/systemd/resolved.conf.d/port.conf')
    hasDualModeConfig = true
  } catch {
    // No dual-mode config
  }

  if (systemdResolvedActive && hasDualModeConfig) {
    output.info('Detected dual-mode configuration (dnsmasq + systemd-resolved)')
    output.newline()
    return await uninstallLinuxDualMode()
  } else {
    output.info('Detected standalone mode configuration (dnsmasq only)')
    output.newline()
    return await uninstallLinuxStandalone()
  }
}

/**
 * Uninstall DNS configuration for *.port domains
 *
 * @param options - Uninstall options (yes for auto-confirm)
 */
export async function uninstall(options?: { yes?: boolean }): Promise<void> {
  // First check if DNS is configured
  output.info('Checking DNS configuration...')
  const isConfigured = await checkDns('port', DEFAULT_DNS_IP)

  if (!isConfigured) {
    output.dim('DNS is not configured for *.port domains')
    output.dim('Nothing to uninstall')
    return
  }

  const platform = process.platform

  if (platform !== 'darwin' && platform !== 'linux') {
    output.error('Your platform is not directly supported.')
    output.info('Please manually remove any DNS configuration for *.port domains')
    process.exit(1)
  }

  // Confirm with user (skip if -y flag is provided)
  if (!options?.yes) {
    output.newline()
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Remove DNS configuration for *.port domains?',
        default: false,
      },
    ])

    if (!confirm) {
      output.dim('Uninstall cancelled')
      return
    }
  }

  output.newline()

  let success = false

  if (platform === 'darwin') {
    success = await uninstallMacOS()
  } else if (platform === 'linux') {
    success = await uninstallLinux()
  }

  if (!success) {
    output.newline()
    output.warn('Uninstall incomplete')
    return
  }

  // Verify DNS is no longer working
  output.newline()
  output.info('Verifying DNS configuration removed...')

  // Wait a moment for DNS changes to propagate
  await new Promise(resolve => setTimeout(resolve, 2000))

  const stillConfigured = await checkDns('port', DEFAULT_DNS_IP)

  if (!stillConfigured) {
    output.success('DNS configuration removed successfully!')
  } else {
    output.warn('DNS may still be resolving *.port domains')
    output.info('DNS changes may take a moment to propagate.')
    output.info('You may need to flush your DNS cache:')
    if (platform === 'darwin') {
      output.info(
        `  ${output.command('sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder')}`
      )
    } else {
      output.info(`  ${output.command('sudo systemd-resolve --flush-caches')}`)
    }
  }
}

import inquirer from 'inquirer'
import { checkDns, isSystemdResolvedRunning, DEFAULT_DNS_IP, DEFAULT_DOMAIN } from '../lib/dns.ts'
import { detectWorktree } from '../lib/worktree.ts'
import { configExists, loadConfig } from '../lib/config.ts'
import * as output from '../lib/output.ts'
import { execAsync, execPrivileged } from '../lib/exec.ts'

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

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase()
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function resolveUninstallDomain(explicitDomain?: string): Promise<string> {
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
 * Uninstall DNS configuration for wildcard domains on macOS
 */
async function uninstallMacOS(domain: string): Promise<boolean> {
  // Determine Homebrew prefix (Intel vs Apple Silicon)
  let brewPrefix: string
  try {
    const { stdout } = await execAsync('brew --prefix')
    brewPrefix = stdout.trim()
  } catch {
    brewPrefix = '/opt/homebrew' // Default for Apple Silicon
  }

  const dnsmasqConf = `${brewPrefix}/etc/dnsmasq.conf`

  // Remove the domain configuration from dnsmasq.conf
  output.info(`Removing .${domain} configuration from dnsmasq...`)
  try {
    const domainPattern = escapeRegex(domain)
    // Check if dnsmasq.conf exists and has our config
    const { stdout } = await execAsync(
      `grep "address=/${domainPattern}/" ${dnsmasqConf} 2>/dev/null || true`
    )
    if (stdout.trim()) {
      // Remove lines containing address=/<domain>/
      await execAsync(`sed -i '' '/address=\\/${domainPattern}\\//d' ${dnsmasqConf}`)
      output.success(`Removed .${domain} configuration from dnsmasq.conf`)
    } else {
      output.dim(`No .${domain} configuration found in dnsmasq.conf`)
    }
  } catch (error) {
    output.warn(`Could not modify dnsmasq.conf: ${error}`)
  }

  // Remove the resolver file
  output.info(`Removing resolver for .${domain} domain...`)
  try {
    await execAsync(`test -f /etc/resolver/${domain}`)
    await execPrivileged(`rm /etc/resolver/${domain}`)
    output.success(`Removed /etc/resolver/${domain}`)
  } catch {
    output.dim(`No resolver file found at /etc/resolver/${domain}`)
  }

  // Restart dnsmasq if it's running (to apply the config changes)
  if (await isDnsmasqRunning()) {
    output.info('Restarting dnsmasq to apply changes...')
    try {
      await execPrivileged(`${brewPrefix}/bin/brew services restart dnsmasq`)
      output.success('dnsmasq restarted')
    } catch (error) {
      output.warn(`Could not restart dnsmasq: ${error}`)
    }
  }

  return true
}

/**
 * Uninstall DNS configuration for wildcard domains on Linux (dual-mode)
 * Removes dnsmasq config on port 5354 and systemd-resolved forwarding
 */
async function uninstallLinuxDualMode(domain: string): Promise<boolean> {
  // Remove dnsmasq configuration
  output.info('Removing dnsmasq configuration...')
  try {
    await execAsync(`test -f /etc/dnsmasq.d/${domain}.conf`)
    await execPrivileged(`rm /etc/dnsmasq.d/${domain}.conf`)
    output.success(`Removed /etc/dnsmasq.d/${domain}.conf`)
  } catch {
    output.dim(`No dnsmasq configuration found at /etc/dnsmasq.d/${domain}.conf`)
  }

  // Restart dnsmasq if it's running
  if (await commandExists('dnsmasq')) {
    try {
      await execAsync('systemctl is-active dnsmasq')
      output.info('Restarting dnsmasq...')
      await execPrivileged('systemctl restart dnsmasq')
      output.success('dnsmasq restarted')
    } catch {
      output.dim('dnsmasq service is not running')
    }
  }

  // Remove systemd-resolved configuration
  output.info('Removing systemd-resolved configuration...')
  try {
    await execAsync(`test -f /etc/systemd/resolved.conf.d/${domain}.conf`)
    await execPrivileged(`rm /etc/systemd/resolved.conf.d/${domain}.conf`)
    output.success(`Removed /etc/systemd/resolved.conf.d/${domain}.conf`)

    // Restart systemd-resolved to apply changes
    output.info('Restarting systemd-resolved...')
    await execPrivileged('systemctl restart systemd-resolved')
    output.success('systemd-resolved restarted')
  } catch {
    output.dim(
      `No systemd-resolved configuration found at /etc/systemd/resolved.conf.d/${domain}.conf`
    )
  }

  return true
}

/**
 * Uninstall DNS configuration for wildcard domains on Linux (standalone mode)
 * Removes dnsmasq config on port 53
 */
async function uninstallLinuxStandalone(domain: string): Promise<boolean> {
  // Remove dnsmasq configuration
  output.info('Removing dnsmasq configuration...')
  try {
    await execAsync(`test -f /etc/dnsmasq.d/${domain}.conf`)
    await execPrivileged(`rm /etc/dnsmasq.d/${domain}.conf`)
    output.success(`Removed /etc/dnsmasq.d/${domain}.conf`)
  } catch {
    output.dim(`No dnsmasq configuration found at /etc/dnsmasq.d/${domain}.conf`)
  }

  // Restart dnsmasq if it's running
  if (await commandExists('dnsmasq')) {
    try {
      await execAsync('systemctl is-active dnsmasq')
      output.info('Restarting dnsmasq...')
      await execPrivileged('systemctl restart dnsmasq')
      output.success('dnsmasq restarted')
    } catch {
      output.dim('dnsmasq service is not running')
    }
  }

  return true
}

/**
 * Uninstall DNS configuration for wildcard domains on Linux
 * Detects the mode (dual or standalone) and removes the appropriate configuration
 */
async function uninstallLinux(domain: string): Promise<boolean> {
  const systemdResolvedActive = await isSystemdResolvedRunning()

  // Check if we have systemd-resolved config (indicates dual-mode was used)
  let hasDualModeConfig = false
  try {
    await execAsync(`test -f /etc/systemd/resolved.conf.d/${domain}.conf`)
    hasDualModeConfig = true
  } catch {
    // No dual-mode config
  }

  if (systemdResolvedActive && hasDualModeConfig) {
    output.info('Detected dual-mode configuration (dnsmasq + systemd-resolved)')
    output.newline()
    return await uninstallLinuxDualMode(domain)
  } else {
    output.info('Detected standalone mode configuration (dnsmasq only)')
    output.newline()
    return await uninstallLinuxStandalone(domain)
  }
}

/**
 * Uninstall DNS configuration for wildcard domains
 *
 * @param options - Uninstall options (yes for auto-confirm)
 */
export async function uninstall(options?: { yes?: boolean; domain?: string }): Promise<void> {
  const domain = await resolveUninstallDomain(options?.domain)

  // First check if DNS is configured
  output.info('Checking DNS configuration...')
  const isConfigured = await checkDns(domain, DEFAULT_DNS_IP)

  if (!isConfigured) {
    output.dim(`DNS is not configured for *.${domain} domains`)
    output.dim('Nothing to uninstall')
    return
  }

  const platform = process.platform

  if (platform !== 'darwin' && platform !== 'linux') {
    output.error('Your platform is not directly supported.')
    output.info(`Please manually remove any DNS configuration for *.${domain} domains`)
    process.exit(1)
  }

  // Confirm with user (skip if -y flag is provided)
  if (!options?.yes) {
    output.newline()
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Remove DNS configuration for *.${domain} domains?`,
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
    success = await uninstallMacOS(domain)
  } else if (platform === 'linux') {
    success = await uninstallLinux(domain)
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

  const stillConfigured = await checkDns(domain, DEFAULT_DNS_IP)

  if (!stillConfigured) {
    output.success('DNS configuration removed successfully!')
  } else {
    output.warn(`DNS may still be resolving *.${domain} domains`)
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

import { exec } from 'child_process'
import { promisify } from 'util'
import inquirer from 'inquirer'
import { checkDns, getDnsSetupInstructions } from '../lib/dns.ts'
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
 */
async function installMacOS(): Promise<boolean> {
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
      `grep -q "address=/port/127.0.0.1" ${dnsmasqConf} && echo "found"`
    )
    if (stdout.trim() === 'found') {
      output.dim('dnsmasq already configured for .port domain')
    }
  } catch {
    // Not configured yet, add it
    output.info('Configuring dnsmasq for .port domain...')
    try {
      await execAsync(`echo "address=/port/127.0.0.1" >> ${dnsmasqConf}`)
      output.success('dnsmasq configured')
    } catch (error) {
      output.error(`Failed to configure dnsmasq: ${error}`)
      return false
    }
  }

  // Start/restart dnsmasq service
  output.info('Starting dnsmasq service...')
  try {
    await execAsync('sudo brew services restart dnsmasq')
    output.success('dnsmasq service started')
  } catch (error) {
    output.error(`Failed to start dnsmasq: ${error}`)
    output.info('You may need to run: sudo brew services start dnsmasq')
    return false
  }

  // Create resolver directory and file
  output.info('Creating resolver for .port domain...')
  try {
    await execAsync('sudo mkdir -p /etc/resolver')
    await execAsync('echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/port > /dev/null')
    output.success('Resolver created at /etc/resolver/port')
  } catch (error) {
    output.error(`Failed to create resolver: ${error}`)
    return false
  }

  return true
}

/**
 * Install and configure DNS for *.port domains on Linux
 */
async function installLinux(): Promise<boolean> {
  output.info('Linux DNS setup requires manual configuration.')
  output.newline()

  const { instructions } = getDnsSetupInstructions()

  output.header('Follow these steps:')
  output.newline()

  for (const line of instructions) {
    console.log(line)
  }

  output.newline()
  output.info('After completing the setup, run "port install" again to verify.')

  return false
}

/**
 * Install DNS configuration for *.port domains
 */
export async function install(): Promise<void> {
  // First check if DNS is already configured
  output.info('Checking DNS configuration...')
  const alreadyConfigured = await checkDns()

  if (alreadyConfigured) {
    output.success('DNS is already configured for *.port domains')
    output.dim('No changes needed')
    return
  }

  // Get platform-specific instructions
  const { platform } = getDnsSetupInstructions()

  if (platform === 'unsupported') {
    output.error('Your platform is not directly supported.')
    output.info('Configure your DNS to resolve *.port to 127.0.0.1')
    process.exit(1)
  }

  // Confirm with user
  output.newline()
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Configure DNS to resolve *.port to 127.0.0.1?',
      default: true,
    },
  ])

  if (!confirm) {
    output.dim('DNS setup cancelled')
    return
  }

  output.newline()

  let success = false

  if (platform === 'macos') {
    success = await installMacOS()
  } else if (platform === 'linux') {
    success = await installLinux()
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

  const verified = await checkDns()

  if (verified) {
    output.success('DNS configured successfully!')
    output.info(`Test with: ${output.command('ping test.port')}`)
  } else {
    output.warn('DNS verification failed')
    output.info('DNS changes may take a moment to propagate. Try again in a few seconds.')
    output.info(`Test manually with: ${output.command('dig test.port')}`)
  }
}

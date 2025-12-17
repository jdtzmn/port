import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/** Default domain suffix */
export const DEFAULT_DOMAIN = 'port'

/**
 * Check if DNS is configured for *.port domains
 * Tests by resolving a random subdomain to see if it returns 127.0.0.1
 *
 * @param domain - The domain suffix to check (default: 'port')
 * @returns true if DNS is configured correctly
 */
export async function checkDns(domain: string = DEFAULT_DOMAIN): Promise<boolean> {
  // Use a random subdomain to avoid caching issues
  const testHost = `port-dns-test-${Date.now()}.${domain}`

  try {
    // Try to resolve the hostname
    const { stdout } = await execAsync(`dig +short ${testHost} A`, {
      timeout: 5000,
    })

    const resolved = stdout.trim()

    // Check if it resolves to 127.0.0.1
    return resolved === '127.0.0.1'
  } catch {
    // dig failed or timed out
    return false
  }
}

/**
 * Get the platform-specific instructions for DNS setup
 *
 * @returns Object with platform name and setup instructions
 */
export function getDnsSetupInstructions(): {
  platform: 'macos' | 'linux' | 'unsupported'
  instructions: string[]
} {
  const platform = process.platform

  if (platform === 'darwin') {
    return {
      platform: 'macos',
      instructions: [
        '# Install dnsmasq',
        'brew install dnsmasq',
        '',
        '# Configure dnsmasq',
        'echo "address=/port/127.0.0.1" >> /opt/homebrew/etc/dnsmasq.conf',
        '',
        '# Start dnsmasq service',
        'sudo brew services start dnsmasq',
        '',
        '# Create resolver',
        'sudo mkdir -p /etc/resolver',
        'echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/port',
      ],
    }
  }

  if (platform === 'linux') {
    return {
      platform: 'linux',
      instructions: [
        '# Option A: Using dnsmasq',
        'sudo apt install dnsmasq',
        'echo "address=/port/127.0.0.1" | sudo tee /etc/dnsmasq.d/port.conf',
        'sudo systemctl restart dnsmasq',
        '',
        '# Option B: Using systemd-resolved',
        '# Add to /etc/systemd/resolved.conf.d/port.conf:',
        '# [Resolve]',
        '# DNS=127.0.0.1',
        '# Domains=port',
      ],
    }
  }

  return {
    platform: 'unsupported',
    instructions: [
      'Your platform is not directly supported.',
      'Configure your DNS to resolve *.port to 127.0.0.1',
    ],
  }
}

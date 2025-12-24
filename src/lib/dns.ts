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
    // Use platform-specific DNS resolution that respects system resolver
    // Note: `dig` doesn't use macOS's /etc/resolver/ system, so we use dscacheutil on macOS
    // and getent on Linux, which properly use the system resolver
    const platform = process.platform
    let resolved = ''

    if (platform === 'darwin') {
      // macOS: use dscacheutil which respects /etc/resolver/
      const { stdout } = await execAsync(`dscacheutil -q host -a name ${testHost}`, {
        timeout: 5000,
      })
      // Parse output like "name: test.port\nip_address: 127.0.0.1"
      const match = stdout.match(/ip_address:\s*(\S+)/)
      resolved = match?.[1] ?? ''
    } else {
      // Linux: use getent which respects system resolver
      const { stdout } = await execAsync(`getent hosts ${testHost}`, {
        timeout: 5000,
      })
      // Parse output like "127.0.0.1    test.port"
      resolved = stdout.trim().split(/\s+/)[0] ?? ''
    }

    // Check if it resolves to 127.0.0.1
    return resolved === '127.0.0.1'
  } catch {
    // Resolution failed or timed out
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

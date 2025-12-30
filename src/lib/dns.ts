import { execAsync } from './exec.ts'

/** Default domain suffix */
export const DEFAULT_DOMAIN = 'port'

/** Default DNS IP address */
export const DEFAULT_DNS_IP = '127.0.0.1'

/** Port for dnsmasq when systemd-resolved is running on port 53 */
export const DNSMASQ_ALT_PORT = 5354

/**
 * Check if systemd-resolved is running
 *
 * @returns true if systemd-resolved service is active
 */
export async function isSystemdResolvedRunning(): Promise<boolean> {
  try {
    await execAsync('systemctl is-active systemd-resolved')
    return true
  } catch {
    return false
  }
}

/**
 * Check if a specific port is in use
 *
 * @param port - The port number to check
 * @returns true if the port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    await execAsync(`ss -tlnp | grep :${port}`)
    return true
  } catch {
    return false
  }
}

/**
 * Validate if a string is a valid IPv4 address
 *
 * @param ip - The IP address to validate
 * @returns true if the IP is a valid IPv4 address
 */
export function isValidIp(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const match = ip.match(ipv4Regex)

  if (!match) {
    return false
  }

  // Check each octet is between 0-255
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i] ?? '0', 10)
    if (octet < 0 || octet > 255) {
      return false
    }
  }

  return true
}

/**
 * Check if DNS is configured for *.port domains
 * Tests by resolving a random subdomain to see if it returns the expected IP
 *
 * @param domain - The domain suffix to check (default: 'port')
 * @param ip - The expected IP address (default: '127.0.0.1')
 * @returns true if DNS is configured correctly
 */
export async function checkDns(
  domain: string = DEFAULT_DOMAIN,
  ip: string = DEFAULT_DNS_IP
): Promise<boolean> {
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

    // Check if it resolves to the expected IP
    return resolved === ip
  } catch {
    // Resolution failed or timed out
    return false
  }
}

/**
 * Get the platform-specific instructions for DNS setup
 *
 * @param ip - The IP address to configure DNS to resolve to (default: '127.0.0.1')
 * @returns Object with platform name and setup instructions
 */
export function getDnsSetupInstructions(ip: string = DEFAULT_DNS_IP): {
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
        `echo "address=/port/${ip}" >> /opt/homebrew/etc/dnsmasq.conf`,
        '',
        '# Start dnsmasq service',
        'sudo brew services start dnsmasq',
        '',
        '# Create resolver',
        'sudo mkdir -p /etc/resolver',
        `echo "nameserver ${ip}" | sudo tee /etc/resolver/port`,
      ],
    }
  }

  if (platform === 'linux') {
    return {
      platform: 'linux',
      instructions: [
        '# Option A: dnsmasq standalone (if systemd-resolved is NOT running)',
        'sudo apt install dnsmasq',
        `echo "address=/port/${ip}" | sudo tee /etc/dnsmasq.d/port.conf`,
        'sudo systemctl restart dnsmasq',
        '',
        '# Option B: dnsmasq + systemd-resolved (if systemd-resolved IS running)',
        '# Run dnsmasq on port 5354 to avoid conflict:',
        'sudo apt install dnsmasq',
        'sudo systemctl stop dnsmasq',
        'sudo systemctl disable dnsmasq',
        `echo -e "port=${DNSMASQ_ALT_PORT}\\naddress=/port/${ip}" | sudo tee /etc/dnsmasq.d/port.conf`,
        'sudo dnsmasq',
        '',
        '# Configure systemd-resolved to forward *.port queries:',
        'sudo mkdir -p /etc/systemd/resolved.conf.d/',
        `echo -e "[Resolve]\\nDNS=127.0.0.1:${DNSMASQ_ALT_PORT}\\nDomains=~port" | sudo tee /etc/systemd/resolved.conf.d/port.conf`,
        'sudo systemctl restart systemd-resolved',
      ],
    }
  }

  return {
    platform: 'unsupported',
    instructions: [
      'Your platform is not directly supported.',
      `Configure your DNS to resolve *.port to ${ip}`,
    ],
  }
}

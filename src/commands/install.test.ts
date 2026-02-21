import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  checkDns: vi.fn(),
  getDnsSetupInstructions: vi.fn(),
  isValidIp: vi.fn(),
  isSystemdResolvedRunning: vi.fn(),
  isPortInUse: vi.fn(),
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  execAsync: vi.fn(),
  execPrivileged: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
  command: vi.fn((value: string) => value),
}))

vi.mock('inquirer', () => ({
  default: {
    prompt: mocks.prompt,
  },
}))

vi.mock('../lib/dns.ts', () => ({
  checkDns: mocks.checkDns,
  getDnsSetupInstructions: mocks.getDnsSetupInstructions,
  isValidIp: mocks.isValidIp,
  isSystemdResolvedRunning: mocks.isSystemdResolvedRunning,
  isPortInUse: mocks.isPortInUse,
  DEFAULT_DNS_IP: '127.0.0.1',
  DEFAULT_DOMAIN: 'port',
  DNSMASQ_ALT_PORT: 5354,
}))

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: mocks.detectWorktree,
}))

vi.mock('../lib/config.ts', () => ({
  configExists: mocks.configExists,
  loadConfig: mocks.loadConfig,
}))

vi.mock('../lib/exec.ts', () => ({
  execAsync: mocks.execAsync,
  execPrivileged: mocks.execPrivileged,
}))

vi.mock('../lib/output.ts', () => ({
  success: mocks.success,
  warn: mocks.warn,
  error: mocks.error,
  info: mocks.info,
  dim: mocks.dim,
  newline: mocks.newline,
  command: mocks.command,
}))

import { install } from './install.ts'

describe('install command domain handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.checkDns.mockResolvedValue(true)
    mocks.getDnsSetupInstructions.mockReturnValue({ platform: 'macos', instructions: [] })
    mocks.isValidIp.mockReturnValue(true)
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not in git')
    })
    mocks.configExists.mockReturnValue(false)
    mocks.loadConfig.mockResolvedValue({ domain: 'port' })
    mocks.execPrivileged.mockResolvedValue({ stdout: '' })
  })

  test('uses default .port domain when no repo config is available', async () => {
    await install({ yes: true })

    expect(mocks.checkDns).toHaveBeenCalledWith('port', '127.0.0.1')
    expect(mocks.success).toHaveBeenCalledWith(
      'DNS is already configured for *.port domains (127.0.0.1)'
    )
  })

  test('uses configured domain from .port/config.jsonc when available', async () => {
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'stlabs' })

    await install({ yes: true })

    expect(mocks.checkDns).toHaveBeenCalledWith('stlabs', '127.0.0.1')
    expect(mocks.success).toHaveBeenCalledWith(
      'DNS is already configured for *.stlabs domains (127.0.0.1)'
    )
  })

  test('explicit --domain overrides config domain', async () => {
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'stlabs' })

    await install({ yes: true, domain: 'custom' })

    expect(mocks.checkDns).toHaveBeenCalledWith('custom', '127.0.0.1')
    expect(mocks.success).toHaveBeenCalledWith(
      'DNS is already configured for *.custom domains (127.0.0.1)'
    )
  })

  test('uses updated config domain when switching from .port to .custom', async () => {
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo' })
    mocks.configExists.mockReturnValue(true)

    mocks.loadConfig
      .mockResolvedValueOnce({ domain: 'port' })
      .mockResolvedValueOnce({ domain: 'custom' })

    await install({ yes: true })
    await install({ yes: true })

    expect(mocks.checkDns).toHaveBeenNthCalledWith(1, 'port', '127.0.0.1')
    expect(mocks.checkDns).toHaveBeenNthCalledWith(2, 'custom', '127.0.0.1')
  })

  test('restarts dnsmasq when adding a domain mapping while service is running', async () => {
    mocks.checkDns.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew' || cmd === 'which dnsmasq') {
        return { stdout: '/opt/homebrew/bin/dnsmasq\n' }
      }

      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }

      if (cmd.includes('grep -q "address=/stlabs/127.0.0.1"')) {
        throw new Error('missing mapping')
      }

      if (cmd.includes('echo "address=/stlabs/127.0.0.1" >> /opt/homebrew/etc/dnsmasq.conf')) {
        return { stdout: '' }
      }

      if (cmd === 'cat /etc/resolver/stlabs 2>/dev/null') {
        return { stdout: 'nameserver 127.0.0.1\n' }
      }

      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '123\n' }
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    expect(mocks.execAsync).toHaveBeenCalledWith(
      'echo "address=/stlabs/127.0.0.1" >> /opt/homebrew/etc/dnsmasq.conf'
    )
    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      '/opt/homebrew/bin/brew services restart dnsmasq'
    )
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq service reloaded')
  })

  test('restarts dnsmasq even when mapping already exists but DNS probe fails', async () => {
    mocks.checkDns.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew' || cmd === 'which dnsmasq') {
        return { stdout: '/opt/homebrew/bin/dnsmasq\n' }
      }

      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }

      if (cmd.includes('grep -q "address=/stlabs/127.0.0.1"')) {
        return { stdout: 'found\n' }
      }

      if (cmd === 'cat /etc/resolver/stlabs 2>/dev/null') {
        return { stdout: 'nameserver 127.0.0.1\n' }
      }

      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '123\n' }
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      '/opt/homebrew/bin/brew services restart dnsmasq'
    )
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq service reloaded')
  })

  test('creates resolver even when dnsmasq service restart fails (non-admin user)', async () => {
    mocks.checkDns.mockResolvedValue(false)

    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew' || cmd === 'which dnsmasq') {
        return { stdout: '/opt/homebrew/bin/dnsmasq\n' }
      }

      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }

      if (cmd === 'cat /etc/resolver/stlabs') {
        throw new Error('missing resolver')
      }

      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '123\n' }
      }

      return { stdout: '' }
    })

    mocks.execPrivileged.mockImplementation(async (cmd: string) => {
      if (cmd === 'mkdir -p /etc/resolver') {
        return { stdout: '' }
      }

      if (cmd === 'echo "nameserver 127.0.0.1" > /etc/resolver/stlabs') {
        return { stdout: '' }
      }

      if (cmd === '/opt/homebrew/bin/brew services restart dnsmasq') {
        throw new Error('permission denied')
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    // Resolver was still created despite service failure
    expect(mocks.execPrivileged).toHaveBeenCalledWith('mkdir -p /etc/resolver')
    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      'echo "nameserver 127.0.0.1" > /etc/resolver/stlabs'
    )
    expect(mocks.success).toHaveBeenCalledWith('Resolver created at /etc/resolver/stlabs')
    // Service failure is reported
    expect(mocks.info).toHaveBeenCalledWith('Run this command as an admin user:')
    expect(mocks.info).toHaveBeenCalledWith(
      '  sudo /opt/homebrew/bin/brew services restart dnsmasq'
    )
    expect(mocks.warn).toHaveBeenCalledWith('DNS setup incomplete')
  })

  test('still attempts service restart when resolver creation fails', async () => {
    mocks.checkDns.mockResolvedValue(false)

    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew' || cmd === 'which dnsmasq') {
        return { stdout: '/opt/homebrew/bin/dnsmasq\n' }
      }

      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }

      if (cmd === 'cat /etc/resolver/stlabs') {
        throw new Error('missing resolver')
      }

      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '123\n' }
      }

      return { stdout: '' }
    })

    mocks.execPrivileged.mockImplementation(async (cmd: string) => {
      if (cmd === 'mkdir -p /etc/resolver') {
        throw new Error('permission denied')
      }

      if (cmd === '/opt/homebrew/bin/brew services restart dnsmasq') {
        return { stdout: '' }
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    // Service restart was still attempted despite resolver failure
    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      '/opt/homebrew/bin/brew services restart dnsmasq'
    )
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq service reloaded')
    // But overall result is incomplete
    expect(mocks.warn).toHaveBeenCalledWith('DNS setup incomplete')
  })

  test('uses start instead of restart when dnsmasq is not running', async () => {
    mocks.checkDns.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew' || cmd === 'which dnsmasq') {
        return { stdout: '/opt/homebrew/bin/dnsmasq\n' }
      }

      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }

      if (cmd.includes('grep -q "address=/stlabs/127.0.0.1"')) {
        return { stdout: 'found\n' }
      }

      if (cmd === 'cat /etc/resolver/stlabs 2>/dev/null') {
        return { stdout: 'nameserver 127.0.0.1\n' }
      }

      if (cmd === 'pgrep dnsmasq') {
        throw new Error('not running')
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      '/opt/homebrew/bin/brew services start dnsmasq'
    )
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq service started')
  })
})

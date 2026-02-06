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

      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '123\n' }
      }

      if (cmd === 'sudo brew services restart dnsmasq') {
        return { stdout: '' }
      }

      if (cmd === 'cat /etc/resolver/stlabs 2>/dev/null') {
        return { stdout: 'nameserver 127.0.0.1\n' }
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    expect(mocks.execAsync).toHaveBeenCalledWith(
      'echo "address=/stlabs/127.0.0.1" >> /opt/homebrew/etc/dnsmasq.conf'
    )
    expect(mocks.execAsync).toHaveBeenCalledWith('sudo brew services restart dnsmasq')
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

      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '123\n' }
      }

      if (cmd === 'sudo brew services restart dnsmasq') {
        return { stdout: '' }
      }

      if (cmd === 'cat /etc/resolver/stlabs 2>/dev/null') {
        return { stdout: 'nameserver 127.0.0.1\n' }
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    expect(mocks.execAsync).toHaveBeenCalledWith('sudo brew services restart dnsmasq')
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq service reloaded')
  })
})

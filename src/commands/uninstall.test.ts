import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  checkDns: vi.fn(),
  isSystemdResolvedRunning: vi.fn(),
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
  isSystemdResolvedRunning: mocks.isSystemdResolvedRunning,
  DEFAULT_DNS_IP: '127.0.0.1',
  DEFAULT_DOMAIN: 'port',
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

import { uninstall } from './uninstall.ts'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

async function runUninstall(options?: { yes?: boolean; domain?: string }): Promise<void> {
  const pending = uninstall(options)
  await vi.runAllTimersAsync()
  await pending
}

describe('uninstall command', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    setPlatform('darwin')
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not in git')
    })
    mocks.configExists.mockReturnValue(false)
    mocks.loadConfig.mockResolvedValue({ domain: 'port' })
    mocks.checkDns.mockResolvedValue(true)
    mocks.isSystemdResolvedRunning.mockResolvedValue(false)
    mocks.execAsync.mockResolvedValue({ stdout: '' })
    mocks.execPrivileged.mockResolvedValue({ stdout: '' })
    mocks.prompt.mockResolvedValue({ confirm: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    setPlatform(originalPlatform)
  })

  test('no-ops when DNS is not configured', async () => {
    mocks.checkDns.mockResolvedValue(false)

    await runUninstall({ yes: true })

    expect(mocks.dim).toHaveBeenCalledWith('DNS is not configured for *.port domains')
    expect(mocks.dim).toHaveBeenCalledWith('Nothing to uninstall')
    expect(mocks.execAsync).not.toHaveBeenCalled()
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  test('prompts for confirmation and cancels when declined', async () => {
    mocks.prompt.mockResolvedValue({ confirm: false })

    await runUninstall()

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        message: 'Remove DNS configuration for *.port domains?',
      }),
    ])
    expect(mocks.dim).toHaveBeenCalledWith('Uninstall cancelled')
    expect(mocks.execAsync).not.toHaveBeenCalled()
  })

  test('continues uninstall after confirmation', async () => {
    mocks.checkDns.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew --prefix') {
        return { stdout: '/usr/local\n' }
      }
      if (cmd.includes('grep "address=/port/"')) {
        return { stdout: 'address=/port/127.0.0.1\n' }
      }
      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '123\n' }
      }

      return { stdout: '' }
    })

    await runUninstall()

    expect(mocks.prompt).toHaveBeenCalledTimes(1)
    expect(mocks.execAsync).toHaveBeenCalledWith('brew --prefix')
    expect(mocks.success).toHaveBeenCalledWith('DNS configuration removed successfully!')
  })

  test('skips prompt when --yes is provided', async () => {
    mocks.checkDns.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }
      if (cmd === 'pgrep dnsmasq') {
        throw new Error('not running')
      }

      return { stdout: '' }
    })

    await runUninstall({ yes: true })

    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.execAsync).toHaveBeenCalledWith('brew --prefix')
  })

  test('uses macOS uninstall path when platform is darwin', async () => {
    setPlatform('darwin')
    mocks.checkDns.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew --prefix') {
        return { stdout: '/usr/local\n' }
      }
      if (cmd.includes('grep "address=/port/"')) {
        return { stdout: 'address=/port/127.0.0.1\n' }
      }
      if (cmd === 'pgrep dnsmasq') {
        return { stdout: '99\n' }
      }

      return { stdout: '' }
    })

    await runUninstall({ yes: true })

    expect(mocks.execAsync).toHaveBeenCalledWith(
      "sed -i '' '/address=\\/port\\//d' /usr/local/etc/dnsmasq.conf"
    )
    expect(mocks.execPrivileged).toHaveBeenCalledWith('rm /etc/resolver/port')
    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      '/usr/local/bin/brew services restart dnsmasq'
    )
    expect(mocks.execPrivileged).not.toHaveBeenCalledWith('systemctl restart systemd-resolved')
  })

  test('uses custom domain when explicitly provided', async () => {
    setPlatform('darwin')
    mocks.checkDns.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'brew --prefix') {
        return { stdout: '/usr/local\n' }
      }
      if (cmd.includes('grep "address=/custom/"')) {
        return { stdout: 'address=/custom/127.0.0.1\n' }
      }
      if (cmd === 'pgrep dnsmasq') {
        throw new Error('not running')
      }

      return { stdout: '' }
    })

    await runUninstall({ yes: true, domain: 'custom' })

    expect(mocks.checkDns).toHaveBeenNthCalledWith(1, 'custom', '127.0.0.1')
    expect(mocks.execAsync).toHaveBeenCalledWith(
      "sed -i '' '/address=\\/custom\\//d' /usr/local/etc/dnsmasq.conf"
    )
    expect(mocks.execPrivileged).toHaveBeenCalledWith('rm /etc/resolver/custom')
    expect(mocks.checkDns).toHaveBeenNthCalledWith(2, 'custom', '127.0.0.1')
  })

  test('uses Linux dual-mode uninstall path when systemd-resolved config is present', async () => {
    setPlatform('linux')
    mocks.checkDns.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mocks.isSystemdResolvedRunning.mockResolvedValue(true)
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which dnsmasq') {
        return { stdout: '/usr/sbin/dnsmasq\n' }
      }
      if (cmd === 'systemctl is-active dnsmasq') {
        return { stdout: 'active\n' }
      }

      return { stdout: '' }
    })

    await runUninstall({ yes: true })

    expect(mocks.info).toHaveBeenCalledWith(
      'Detected dual-mode configuration (dnsmasq + systemd-resolved)'
    )
    expect(mocks.execPrivileged).toHaveBeenCalledWith('rm /etc/dnsmasq.d/port.conf')
    expect(mocks.execPrivileged).toHaveBeenCalledWith('systemctl restart dnsmasq')
    expect(mocks.execPrivileged).toHaveBeenCalledWith('rm /etc/systemd/resolved.conf.d/port.conf')
    expect(mocks.execPrivileged).toHaveBeenCalledWith('systemctl restart systemd-resolved')
  })

  test('uses Linux standalone uninstall path when dual-mode is not detected', async () => {
    setPlatform('linux')
    mocks.checkDns.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mocks.isSystemdResolvedRunning.mockResolvedValue(false)
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'test -f /etc/systemd/resolved.conf.d/port.conf') {
        throw new Error('missing file')
      }
      if (cmd === 'which dnsmasq') {
        return { stdout: '/usr/sbin/dnsmasq\n' }
      }
      if (cmd === 'systemctl is-active dnsmasq') {
        return { stdout: 'active\n' }
      }

      return { stdout: '' }
    })

    await runUninstall({ yes: true })

    expect(mocks.info).toHaveBeenCalledWith('Detected standalone mode configuration (dnsmasq only)')
    expect(mocks.execPrivileged).toHaveBeenCalledWith('rm /etc/dnsmasq.d/port.conf')
    expect(mocks.execPrivileged).toHaveBeenCalledWith('systemctl restart dnsmasq')
    expect(mocks.execPrivileged).not.toHaveBeenCalledWith(
      'rm /etc/systemd/resolved.conf.d/port.conf'
    )
    expect(mocks.execPrivileged).not.toHaveBeenCalledWith('systemctl restart systemd-resolved')
  })
})

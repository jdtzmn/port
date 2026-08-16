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
  detectShell: vi.fn(),
  installShellHook: vi.fn(),
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

vi.mock('../lib/shellProfile.ts', () => ({
  detectShell: mocks.detectShell,
  installShellHook: mocks.installShellHook,
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
    mocks.detectShell.mockReturnValue(null)
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

    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      expect.stringContaining(
        'mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > \'/etc/resolver/stlabs\' && /opt/homebrew/bin/brew services restart dnsmasq'
      )
    )
    expect(mocks.execPrivileged).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenCalledWith('Resolver configured at /etc/resolver/stlabs')
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
      expect.stringContaining(
        'mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > \'/etc/resolver/stlabs\' && /opt/homebrew/bin/brew services restart dnsmasq'
      )
    )
    expect(mocks.execPrivileged).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenCalledWith('Resolver configured at /etc/resolver/stlabs')
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq service reloaded')
  })

  test('fails when dnsmasq restart path errors (non-admin user)', async () => {
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
      if (cmd.includes('restart dnsmasq')) {
        throw new Error('permission denied')
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      expect.stringContaining(
        'mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > \'/etc/resolver/stlabs\' && /opt/homebrew/bin/brew services restart dnsmasq'
      )
    )
    expect(mocks.execPrivileged).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to configure macOS DNS:')
    )
    expect(mocks.warn).toHaveBeenCalledWith('DNS setup incomplete')
  })

  test('fails when dnsmasq start path errors', async () => {
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
        throw new Error('not running')
      }

      return { stdout: '' }
    })

    mocks.execPrivileged.mockImplementation(async (cmd: string) => {
      if (cmd.includes('start dnsmasq')) {
        throw new Error('permission denied')
      }

      return { stdout: '' }
    })

    await install({ yes: true, domain: 'stlabs' })

    expect(mocks.execPrivileged).toHaveBeenCalledWith(
      expect.stringContaining(
        'mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > \'/etc/resolver/stlabs\' && /opt/homebrew/bin/brew services start dnsmasq'
      )
    )
    expect(mocks.execPrivileged).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to configure macOS DNS:')
    )
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
      expect.stringContaining(
        'mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > \'/etc/resolver/stlabs\' && /opt/homebrew/bin/brew services start dnsmasq'
      )
    )
    expect(mocks.execPrivileged).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenCalledWith('Resolver configured at /etc/resolver/stlabs')
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq service started')
  })
})

describe('install command confirmation prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.checkDns.mockResolvedValue(false)
    mocks.getDnsSetupInstructions.mockReturnValue({ platform: 'macos', instructions: [] })
    mocks.isValidIp.mockReturnValue(true)
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not in git')
    })
    mocks.configExists.mockReturnValue(false)
    mocks.loadConfig.mockResolvedValue({ domain: 'port' })
    mocks.execPrivileged.mockResolvedValue({ stdout: '' })
    mocks.detectShell.mockReturnValue(null)
  })

  test('prompts for dnsmasq installation when package is not installed (macOS)', async () => {
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew') {
        return { stdout: '/opt/homebrew/bin/brew\n' }
      }

      if (cmd === 'which dnsmasq') {
        throw new Error('dnsmasq not found')
      }

      return { stdout: '' }
    })

    mocks.prompt
      .mockResolvedValueOnce({ confirm: true }) // DNS setup confirmation
      .mockResolvedValueOnce({ confirmInstall: false }) // dnsmasq install confirmation

    await install()

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'confirm',
        name: 'confirmInstall',
        message: 'Install dnsmasq via Homebrew?',
        default: true,
      }),
    ])
    expect(mocks.dim).toHaveBeenCalledWith('dnsmasq installation cancelled')
    expect(mocks.info).toHaveBeenCalledWith(
      'Cannot proceed without dnsmasq. Install manually with: brew install dnsmasq'
    )
  })

  test('skips dnsmasq installation prompt with --yes flag and installs (macOS)', async () => {
    mocks.checkDns.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew') {
        return { stdout: '/opt/homebrew/bin/brew\n' }
      }

      if (cmd === 'which dnsmasq') {
        throw new Error('dnsmasq not found')
      }

      if (cmd === 'brew install dnsmasq') {
        return { stdout: '' }
      }

      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }

      if (cmd === 'cat /etc/resolver/port 2>/dev/null') {
        throw new Error('missing resolver')
      }

      if (cmd === 'pgrep dnsmasq') {
        throw new Error('not running')
      }

      return { stdout: '' }
    })

    await install({ yes: true })

    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith('Installing dnsmasq via Homebrew...')
    expect(mocks.execAsync).toHaveBeenCalledWith('brew install dnsmasq')
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq installed')
  })

  test('proceeds with installation after dnsmasq install confirmation (macOS)', async () => {
    mocks.checkDns.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew') {
        return { stdout: '/opt/homebrew/bin/brew\n' }
      }

      if (cmd === 'which dnsmasq') {
        throw new Error('dnsmasq not found')
      }

      if (cmd === 'brew install dnsmasq') {
        return { stdout: '' }
      }

      if (cmd === 'brew --prefix') {
        return { stdout: '/opt/homebrew\n' }
      }

      if (cmd === 'cat /etc/resolver/port 2>/dev/null') {
        throw new Error('missing resolver')
      }

      if (cmd === 'pgrep dnsmasq') {
        throw new Error('not running')
      }

      return { stdout: '' }
    })

    mocks.prompt
      .mockResolvedValueOnce({ confirm: true }) // DNS setup confirmation
      .mockResolvedValueOnce({ confirmInstall: true }) // dnsmasq install confirmation

    await install()

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        message: 'Install dnsmasq via Homebrew?',
      }),
    ])
    expect(mocks.execAsync).toHaveBeenCalledWith('brew install dnsmasq')
    expect(mocks.success).toHaveBeenCalledWith('dnsmasq installed')
  })

  test('cancels installation when dnsmasq install is declined (macOS)', async () => {
    mocks.execAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which brew') {
        return { stdout: '/opt/homebrew/bin/brew\n' }
      }

      if (cmd === 'which dnsmasq') {
        throw new Error('dnsmasq not found')
      }

      return { stdout: '' }
    })

    mocks.prompt
      .mockResolvedValueOnce({ confirm: true }) // DNS setup confirmation
      .mockResolvedValueOnce({ confirmInstall: false }) // dnsmasq install confirmation

    await install()

    expect(mocks.dim).toHaveBeenCalledWith('dnsmasq installation cancelled')
    expect(mocks.execAsync).not.toHaveBeenCalledWith('brew install dnsmasq')
  })
})

describe('install command shell hook setup', () => {
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
    mocks.detectShell.mockReturnValue('zsh')
    mocks.installShellHook.mockResolvedValue({
      status: 'installed',
      shell: 'zsh',
      profilePath: '/home/dev/.zshrc',
    })
  })

  test('installs the shell hook after DNS is already configured', async () => {
    await install({ yes: true })

    expect(mocks.installShellHook).toHaveBeenCalledWith('zsh')
    expect(mocks.success).toHaveBeenCalledWith('Shell hook added to /home/dev/.zshrc')
  })

  test('skips the shell hook with --no-shell-hook', async () => {
    await install({ yes: true, shellHook: false })

    expect(mocks.installShellHook).not.toHaveBeenCalled()
  })

  test('skips DNS setup with --shell-hook-only', async () => {
    await install({ yes: true, shellHookOnly: true })

    expect(mocks.checkDns).not.toHaveBeenCalled()
    expect(mocks.installShellHook).toHaveBeenCalledWith('zsh')
  })

  test('prompts before touching the profile when not using --yes', async () => {
    mocks.prompt.mockResolvedValueOnce({ confirmHook: false })

    await install({})

    expect(mocks.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'confirmHook',
        message: 'Add the port shell hook to your zsh profile?',
      }),
    ])
    expect(mocks.installShellHook).not.toHaveBeenCalled()
    expect(mocks.dim).toHaveBeenCalledWith('Shell hook setup skipped')
  })

  test('reports an already-configured profile without rewriting it', async () => {
    mocks.installShellHook.mockResolvedValue({
      status: 'already-installed',
      shell: 'zsh',
      profilePath: '/home/dev/.zshrc',
    })

    await install({ yes: true })

    expect(mocks.dim).toHaveBeenCalledWith('Shell hook already present in /home/dev/.zshrc')
  })

  test('prints manual instructions when the shell is unsupported', async () => {
    mocks.detectShell.mockReturnValue(null)

    await install({ yes: true })

    expect(mocks.installShellHook).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      'Could not detect a supported shell (bash, zsh, fish) from $SHELL'
    )
  })
})

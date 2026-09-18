import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // inquirer
  prompt: vi.fn(),

  // dns
  checkDns: vi.fn(),
  getDnsSetupInstructions: vi.fn(),
  isValidIp: vi.fn(),
  isSystemdResolvedRunning: vi.fn(),
  isPortInUse: vi.fn(),

  // worktree / config
  detectWorktree: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),

  // exec (service commands still flow through these)
  execAsync: vi.fn(),
  execPrivileged: vi.fn(),

  // output
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
  newline: vi.fn(),
  command: vi.fn((v: string) => v),

  // shell profile
  detectShell: vi.fn(),
  installShellHook: vi.fn(),
  removeShellHook: vi.fn(),

  // managed SSH services
  enableRemoteRuntime: vi.fn(),
  disableRemoteRuntime: vi.fn(),
  normalizeRemoteSshHostPatterns: vi.fn(),
  installManagedSshConfig: vi.fn(),
  removeManagedSshConfig: vi.fn(),
}))

vi.mock('inquirer', () => ({ default: { prompt: mocks.prompt } }))

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

vi.mock('../lib/shellProfile.ts', () => ({
  detectShell: mocks.detectShell,
  installShellHook: mocks.installShellHook,
  removeShellHook: mocks.removeShellHook,
}))
vi.mock('../lib/remote/coordinator/supervisor.ts', () => ({
  enableRemoteRuntime: mocks.enableRemoteRuntime,
  disableRemoteRuntime: mocks.disableRemoteRuntime,
}))
vi.mock('../lib/remote/session/sshConfig.ts', () => ({
  normalizeRemoteSshHostPatterns: mocks.normalizeRemoteSshHostPatterns,
  installManagedSshConfig: mocks.installManagedSshConfig,
  removeManagedSshConfig: mocks.removeManagedSshConfig,
}))

vi.mock('../lib/worktree.ts', () => ({ detectWorktree: mocks.detectWorktree }))
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

// The fileOps mock is set up per-describe block (see below).
// We dynamically swap the MapFileOps instance so each test suite has its own VFS.
const { MapFileOps } =
  await vi.importActual<typeof import('../lib/fileOps.ts')>('../lib/fileOps.ts')

let mapFileOps: InstanceType<typeof MapFileOps>

vi.mock('../lib/fileOps.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/fileOps.ts')>()
  return {
    ...actual,
    get fileOps() {
      return mapFileOps
    },
  }
})

import { install } from './install.ts'
import { uninstall } from './uninstall.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

/** Run a function that contains setTimeout, advancing fake timers. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  const pending = fn()
  await vi.runAllTimersAsync()
  return pending
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('install + uninstall round-trip', () => {
  let vfs: Map<string, string>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    // Shared defaults
    mocks.isValidIp.mockReturnValue(true)
    mocks.detectWorktree.mockImplementation(() => {
      throw new Error('not in git')
    })
    mocks.configExists.mockReturnValue(false)
    mocks.execAsync.mockResolvedValue({ stdout: '' })
    mocks.execPrivileged.mockResolvedValue({ stdout: '' })
    mocks.detectShell.mockReturnValue(null)
    mocks.enableRemoteRuntime.mockResolvedValue(undefined)
    mocks.disableRemoteRuntime.mockResolvedValue(true)
    mocks.normalizeRemoteSshHostPatterns.mockImplementation((patterns: string[]) =>
      [...new Set(patterns)].sort()
    )
    mocks.installManagedSshConfig.mockResolvedValue(undefined)
    mocks.removeManagedSshConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    setPlatform(originalPlatform)
  })

  // -----------------------------------------------------------------------
  // Linux dual-mode
  // -----------------------------------------------------------------------

  describe('linux dual-mode', () => {
    beforeEach(() => {
      setPlatform('linux')
      mocks.getDnsSetupInstructions.mockReturnValue({ platform: 'linux', instructions: [] })
      mocks.isSystemdResolvedRunning.mockResolvedValue(true)
      mocks.isPortInUse.mockResolvedValue(true)

      // Service / command checks
      mocks.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'which dnsmasq') return { stdout: '/usr/sbin/dnsmasq\n' }
        if (cmd === 'test -f /.dockerenv') throw new Error('not in docker')
        if (cmd === 'systemctl is-active dnsmasq') return { stdout: 'active\n' }
        return { stdout: '' }
      })

      // Start with an empty filesystem
      vfs = new Map()
      mapFileOps = new MapFileOps(vfs)
    })

    test('leaves no files behind after installing and uninstalling two domains', async () => {
      const snapshot = new Map(vfs)

      // Sequence checkDns returns:
      // install(.port):  false (needs install) → true (verified)
      // install(.test):  false (needs install) → true (verified)
      // uninstall(.port): true (is configured) → false (verified removed)
      // uninstall(.test): true (is configured) → false (verified removed)
      mocks.checkDns
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      await run(() => install({ yes: true }))
      await run(() => install({ yes: true, domain: 'test' }))
      await run(() => uninstall({ yes: true }))
      await run(() => uninstall({ yes: true, domain: 'test' }))

      expect(vfs).toEqual(snapshot)
    })
  })

  // -----------------------------------------------------------------------
  // macOS
  // -----------------------------------------------------------------------

  describe('macos', () => {
    beforeEach(() => {
      setPlatform('darwin')
      mocks.getDnsSetupInstructions.mockReturnValue({ platform: 'macos', instructions: [] })
      mocks.isSystemdResolvedRunning.mockResolvedValue(false)

      // Service / command checks
      mocks.execAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'which brew' || cmd === 'which dnsmasq')
          return { stdout: '/opt/homebrew/bin/dnsmasq\n' }
        if (cmd === 'brew --prefix') return { stdout: '/opt/homebrew\n' }
        if (cmd === 'pgrep dnsmasq') return { stdout: '123\n' }
        return { stdout: '' }
      })

      // dnsmasq.conf pre-exists (Homebrew creates it)
      vfs = new Map([['/opt/homebrew/etc/dnsmasq.conf', '']])
      mapFileOps = new MapFileOps(vfs)
    })

    test('leaves no files behind after installing and uninstalling two domains', async () => {
      const snapshot = new Map(vfs)

      mocks.checkDns
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      await run(() => install({ yes: true }))
      await run(() => install({ yes: true, domain: 'test' }))
      await run(() => uninstall({ yes: true }))
      await run(() => uninstall({ yes: true, domain: 'test' }))

      expect(vfs).toEqual(snapshot)
    })
  })

  describe('managed remote SSH services', () => {
    beforeEach(() => {
      mocks.checkDns.mockResolvedValue(true)
      mocks.detectShell.mockReturnValue('bash')
      vfs = new Map()
      mapFileOps = new MapFileOps(vfs)
    })

    test('installs normalized explicit host patterns after enabling the runtime', async () => {
      await install({
        yes: true,
        remoteServices: true,
        remoteHost: ['box.od', '*.od', 'box.od'],
        shellHook: false,
      })

      expect(mocks.checkDns.mock.calls.map(([domain]) => domain)).toEqual([
        'port',
        'port',
        'ssh',
        'ssh',
      ])
      expect(mocks.enableRemoteRuntime).toHaveBeenCalledOnce()
      expect(mocks.installManagedSshConfig).toHaveBeenCalledExactlyOnceWith(['*.od', 'box.od'])
      expect(mocks.installShellHook).not.toHaveBeenCalled()
    })

    test('removes managed configuration and runtime opt-in without changing DNS', async () => {
      await uninstall({ yes: true, remoteServices: true, shellHook: false })

      expect(mocks.removeManagedSshConfig).toHaveBeenCalledOnce()
      expect(mocks.disableRemoteRuntime).toHaveBeenCalledOnce()
      expect(mocks.checkDns).not.toHaveBeenCalled()
      expect(mocks.removeShellHook).not.toHaveBeenCalled()
    })
  })
})

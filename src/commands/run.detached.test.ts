import { existsSync, mkdtempSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChildProcess, SpawnOptions } from 'child_process'
import { PORT_DIR } from '../lib/config.ts'
import { getLogsDir, getServiceLogPath } from '../lib/logs.ts'
import type { HostService } from '../types.ts'

async function waitFor<T>(fn: () => Promise<T> | T, timeoutMs = 5000): Promise<T> {
  const start = Date.now()
  let lastError: unknown

  while (Date.now() - start < timeoutMs) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }

  throw lastError
}

const mocks = vi.hoisted(() => {
  return {
    repoRoot: '',
    worktreePath: '',
    spawnedCommands: [] as Array<{
      cmd: string
      args: string[]
      options: SpawnOptions
    }>,
    spawnedChildren: [] as ChildProcess[],
    registeredServices: [] as HostService[],
    removeHostServiceConfig: vi.fn(),
    unregisterHostService: vi.fn(),
  }
})

vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()

  return {
    ...actual,
    spawn: vi.fn((cmd: string, args: string[] = [], options: SpawnOptions = {}) => {
      mocks.spawnedCommands.push({ cmd, args, options })

      const child = actual.spawn(cmd, args, options)
      mocks.spawnedChildren.push(child)
      return child
    }),
  }
})

vi.mock('../lib/worktree.ts', () => ({
  detectWorktree: () => ({
    repoRoot: mocks.repoRoot,
    worktreePath: mocks.worktreePath,
    name: 'feature-1',
    isMainRepo: false,
  }),
}))

vi.mock('../lib/config.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/config.ts')>()
  return {
    ...actual,
    ensurePortRuntimeDir: vi.fn(),
    loadConfigOrDefault: vi.fn(async () => ({ domain: 'port' })),
  }
})

vi.mock('../lib/registry.ts', () => ({
  getHostService: vi.fn(async () => undefined),
  getAllProjects: vi.fn(async () => []),
  getAllHostServices: vi.fn(async () => []),
}))

vi.mock('../lib/traefik.ts', () => ({
  ensureTraefikPorts: vi.fn(async () => false),
  traefikFilesExist: vi.fn(() => true),
  initTraefikFiles: vi.fn(),
}))

vi.mock('../lib/compose.ts', () => ({
  isTraefikRunning: vi.fn(async () => true),
  startTraefik: vi.fn(),
  restartTraefik: vi.fn(),
}))

vi.mock('../lib/hostService.ts', () => ({
  cleanupStaleHostServices: vi.fn(),
  findAvailablePort: vi.fn(async () => 49152),
  writeHostServiceConfig: vi.fn(async () => '/tmp/port-host-service.yml'),
  removeHostServiceConfig: mocks.removeHostServiceConfig,
  registerHostService: vi.fn(async (service: HostService) => {
    mocks.registeredServices.push({ ...service })
  }),
  unregisterHostService: mocks.unregisterHostService,
  stopHostService: vi.fn(),
  isProcessRunning: vi.fn(() => false),
}))

const { run } = await import('./run.ts')

function longRunningScript(message?: string): string[] {
  const lines = message ? [`console.log(${JSON.stringify(message)})`] : []
  lines.push('setInterval(() => {}, 1000)')
  return ['bun', '-e', lines.join('\n')]
}

describe('port run --detached', () => {
  let exitMock: ReturnType<typeof vi.spyOn>
  let signalHandlers: string[]

  beforeEach(async () => {
    mocks.repoRoot = mkdtempSync(join(tmpdir(), 'port-run-detached-test-'))
    mocks.worktreePath = join(mocks.repoRoot, PORT_DIR, 'trees', 'feature-1')
    mocks.spawnedCommands = []
    mocks.spawnedChildren = []
    mocks.registeredServices = []
    mocks.removeHostServiceConfig.mockClear()
    mocks.unregisterHostService.mockClear()

    await mkdir(mocks.worktreePath, { recursive: true })

    exitMock = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    signalHandlers = []
    const originalOn = process.on.bind(process)
    vi.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
      signalHandlers.push(event)
      return originalOn(event as NodeJS.Signals, listener)
    }) as never)
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    for (const child of mocks.spawnedChildren) {
      child.removeAllListeners('exit')
      child.removeAllListeners('error')
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }

    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGHUP')

    await rm(mocks.repoRoot, { recursive: true, force: true })
  })

  test('spawns the process detached and streams its output to a per-service log file', async () => {
    await run(3000, longRunningScript('hello from detached child'), { detached: true })

    expect(mocks.spawnedCommands).toHaveLength(1)
    const spawnCall = mocks.spawnedCommands[0]!
    expect(spawnCall.options.detached).toBe(true)

    // stdin ignored, stdout/stderr redirected to the log file descriptor
    const stdio = spawnCall.options.stdio as ['ignore', number, number]
    expect(stdio[0]).toBe('ignore')
    expect(typeof stdio[1]).toBe('number')
    expect(stdio[2]).toBe(stdio[1])

    const logFile = getServiceLogPath(mocks.repoRoot, 'feature-1', 3000)
    expect(existsSync(getLogsDir(mocks.repoRoot))).toBe(true)

    await waitFor(async () => {
      const contents = await readFile(logFile, 'utf8')
      expect(contents).toContain('hello from detached child')
    })
  })

  test('registers the detached pid and exits successfully without cleaning up the service', async () => {
    await run(3000, longRunningScript(), { detached: true })

    const child = mocks.spawnedChildren[0]!
    expect(child.pid).toBeGreaterThan(0)
    expect(mocks.registeredServices.at(-1)).toMatchObject({
      branch: 'feature-1',
      logicalPort: 3000,
      actualPort: 49152,
      pid: child.pid,
    })

    expect(exitMock).toHaveBeenCalledWith(0)
    expect(mocks.removeHostServiceConfig).not.toHaveBeenCalled()
    expect(mocks.unregisterHostService).not.toHaveBeenCalled()
  })

  test('does not install signal handlers in detached mode', async () => {
    await run(3000, longRunningScript(), { detached: true })

    expect(signalHandlers).not.toContain('SIGINT')
    expect(signalHandlers).not.toContain('SIGTERM')
    expect(signalHandlers).not.toContain('SIGHUP')
  })

  test('cleans up and exits non-zero when the detached process fails to start', async () => {
    await run(3000, ['port-detached-command-that-does-not-exist'], { detached: true })

    expect(exitMock).toHaveBeenCalledWith(1)
    expect(mocks.removeHostServiceConfig).toHaveBeenCalled()
    expect(mocks.unregisterHostService).toHaveBeenCalled()
  })

  test('foreground mode inherits stdio, installs signal handlers, and writes no service log', async () => {
    await run(3000, longRunningScript(), {})

    const spawnCall = mocks.spawnedCommands[0]!
    expect(spawnCall.options.stdio).toBe('inherit')
    expect(spawnCall.options.detached).toBeFalsy()

    expect(signalHandlers).toContain('SIGINT')
    expect(signalHandlers).toContain('SIGTERM')
    expect(signalHandlers).toContain('SIGHUP')

    expect(existsSync(getServiceLogPath(mocks.repoRoot, 'feature-1', 3000))).toBe(false)
    expect(exitMock).not.toHaveBeenCalled()
  })
})

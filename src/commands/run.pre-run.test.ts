import { EventEmitter } from 'events'
import { mkdir, rm, writeFile, chmod } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChildProcess } from 'child_process'
import { PORT_DIR, HOOKS_DIR } from '../lib/config.ts'

const mocks = vi.hoisted(() => {
  return {
    repoRoot: '',
    worktreePath: '',
    spawnedCommands: [] as Array<{
      cmd: string
      args: string[]
      options: { env?: NodeJS.ProcessEnv }
    }>,
  }
})

vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()

  return {
    ...actual,
    spawn: vi.fn((cmd: string, args: string[] = [], options: { env?: NodeJS.ProcessEnv } = {}) => {
      if (cmd.includes(`/${PORT_DIR}/${HOOKS_DIR}/`)) {
        return actual.spawn(cmd, args, options)
      }

      mocks.spawnedCommands.push({ cmd, args, options })

      const child = new EventEmitter() as ChildProcess & { pid: number }
      child.pid = 12345
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
  removeHostServiceConfig: vi.fn(),
  registerHostService: vi.fn(),
  unregisterHostService: vi.fn(),
  stopHostService: vi.fn(),
}))

const { run } = await import('./run.ts')

describe('port run pre-run hook', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeEach(async () => {
    mocks.repoRoot = mkdtempSync(join(tmpdir(), 'port-run-pre-run-test-'))
    mocks.worktreePath = join(mocks.repoRoot, PORT_DIR, 'trees', 'feature-1')
    mocks.spawnedCommands = []

    const hooksDir = join(mocks.repoRoot, PORT_DIR, HOOKS_DIR)
    await mkdir(hooksDir, { recursive: true })
    await mkdir(mocks.worktreePath, { recursive: true })

    const hookPath = join(hooksDir, 'pre-run.sh')
    await writeFile(
      hookPath,
      [
        '#!/bin/bash',
        'set -euo pipefail',
        'echo "DATABASE_URL=${DATABASE_URL/localhost:5432/$PORT_BRANCH.$PORT_DOMAIN:5432}" >> "$PORT_ENV_FILE"',
        'echo "HOOK_MARKER=ran" >> "$PORT_ENV_FILE"',
      ].join('\n')
    )
    await chmod(hookPath, 0o755)

    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/app_db'
  })

  afterEach(async () => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }

    await rm(mocks.repoRoot, { recursive: true, force: true })
  })

  test('runs pre-run before spawning the host process and applies env overrides', async () => {
    await run(3000, ['bun', 'run', 'dev'])

    expect(mocks.spawnedCommands).toHaveLength(1)
    expect(mocks.spawnedCommands[0]?.options.env).toMatchObject({
      PORT: '49152',
      DATABASE_URL: 'postgres://user:pass@feature-1.port:5432/app_db',
      HOOK_MARKER: 'ran',
    })
  })
})

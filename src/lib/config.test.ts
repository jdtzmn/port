import { mkdtempSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  CONFIG_FILE,
  ConfigError,
  PORT_DIR,
  DEFAULT_DOMAIN,
  DEFAULT_COMPOSE,
  getComposeFile,
  loadConfig,
} from './config.ts'

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'port-config-test-'))
}

describe('loadConfig', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = createTempDir()
    await mkdir(join(repoRoot, PORT_DIR), { recursive: true })
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('accepts trailing comma after last property in jsonc', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(
      configPath,
      [
        '{',
        '  // custom domain with trailing comma',
        '  "domain": "local.test",',
        '  "compose": "compose.dev.yml",',
        '}',
      ].join('\n')
    )

    const config = await loadConfig(repoRoot)

    expect(config.domain).toBe('local.test')
    expect(config.compose).toBe('compose.dev.yml')
  })

  test('still rejects malformed jsonc', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{"domain": "local.test",,}')

    await expect(loadConfig(repoRoot)).rejects.toBeInstanceOf(ConfigError)
  })

  test('retains existing defaults when compose is omitted', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, ['{', '  "domain": "local.test",', '}'].join('\n'))

    const config = await loadConfig(repoRoot)

    expect(config.domain).toBe('local.test')
    expect(getComposeFile(config)).toBe(DEFAULT_COMPOSE)
  })

  test('uses default domain when omitted', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{}')

    const config = await loadConfig(repoRoot)

    expect(config.domain).toBe(DEFAULT_DOMAIN)
  })

  test('parses task config with workers and adapters', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(
      configPath,
      [
        '{',
        '  "task": {',
        '    "daemonIdleStopMinutes": 10,',
        '    "lockMode": "branch",',
        '    "defaultWorker": "main",',
        '    "workers": {',
        '      "main": { "type": "opencode", "adapter": "local" },',
        '      "fast": { "type": "opencode", "adapter": "local", "config": { "model": "fast-model" } }',
        '    },',
        '    "adapters": {',
        '      "sandbox": { "type": "e2b", "config": { "template": "opencode-v2" } }',
        '    },',
        '    "attach": { "enabled": true, "client": "configured" },',
        '    "subscriptions": { "enabled": true, "consumers": ["opencode"] }',
        '  }',
        '}',
      ].join('\n')
    )

    const config = await loadConfig(repoRoot)
    expect(config.task?.daemonIdleStopMinutes).toBe(10)
    expect(config.task?.defaultWorker).toBe('main')
    expect(config.task?.workers?.main?.type).toBe('opencode')
    expect(config.task?.workers?.main?.adapter).toBe('local')
    expect(config.task?.workers?.fast?.config).toEqual({ model: 'fast-model' })
    expect(config.task?.adapters?.sandbox?.type).toBe('e2b')
    expect(config.task?.adapters?.sandbox?.config).toEqual({ template: 'opencode-v2' })
    expect(config.task?.attach?.enabled).toBe(true)
    expect(config.task?.subscriptions?.enabled).toBe(true)
  })

  test('rejects defaultWorker that does not match a worker key', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(
      configPath,
      [
        '{',
        '  "task": {',
        '    "defaultWorker": "nonexistent",',
        '    "workers": {',
        '      "main": { "type": "opencode", "adapter": "local" }',
        '    }',
        '  }',
        '}',
      ].join('\n')
    )

    await expect(loadConfig(repoRoot)).rejects.toBeInstanceOf(ConfigError)
  })

  test('rejects invalid worker type', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(
      configPath,
      '{ "task": { "workers": { "bad": { "type": "invalid", "adapter": "local" } } } }'
    )

    await expect(loadConfig(repoRoot)).rejects.toBeInstanceOf(ConfigError)
  })

  test('rejects invalid adapter type in worker', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(
      configPath,
      '{ "task": { "workers": { "bad": { "type": "opencode", "adapter": "unknown" } } } }'
    )

    await expect(loadConfig(repoRoot)).rejects.toBeInstanceOf(ConfigError)
  })

  test('rejects invalid task lock mode', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{ "task": { "lockMode": "invalid" } }')

    await expect(loadConfig(repoRoot)).rejects.toBeInstanceOf(ConfigError)
  })
})

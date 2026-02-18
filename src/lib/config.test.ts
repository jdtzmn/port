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

  test('parses tcpPorts array', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{ "tcpPorts": [5432, 3306] }')

    const config = await loadConfig(repoRoot)

    expect(config.tcpPorts).toEqual([5432, 3306])
  })

  test('tcpPorts defaults to undefined when omitted', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{}')

    const config = await loadConfig(repoRoot)

    expect(config.tcpPorts).toBeUndefined()
  })

  test('rejects non-array tcpPorts', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{ "tcpPorts": "5432" }')

    await expect(loadConfig(repoRoot)).rejects.toBeInstanceOf(ConfigError)
  })

  test('rejects invalid port numbers in tcpPorts', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{ "tcpPorts": [99999] }')

    await expect(loadConfig(repoRoot)).rejects.toBeInstanceOf(ConfigError)
  })
})

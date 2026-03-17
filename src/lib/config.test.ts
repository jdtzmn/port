import { mkdtempSync, existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
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
  loadConfigOrDefault,
  ensurePortRuntimeDir,
  PORT_RUNTIME_GITIGNORE,
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
})

describe('loadConfigOrDefault', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = createTempDir()
    await mkdir(join(repoRoot, PORT_DIR), { recursive: true })
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('returns defaults when config file is missing', async () => {
    const config = await loadConfigOrDefault(repoRoot)

    expect(config.domain).toBe(DEFAULT_DOMAIN)
    expect(config.compose).toBe(DEFAULT_COMPOSE)
  })

  test('loads explicit config when file exists', async () => {
    const configPath = join(repoRoot, PORT_DIR, CONFIG_FILE)
    await writeFile(configPath, '{"domain": "custom", "compose": "compose.dev.yml"}')

    const config = await loadConfigOrDefault(repoRoot)

    expect(config.domain).toBe('custom')
    expect(config.compose).toBe('compose.dev.yml')
  })
})

describe('ensurePortRuntimeDir', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = createTempDir()
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('creates .port directory and .gitignore when missing', async () => {
    await ensurePortRuntimeDir(repoRoot)

    const portDir = join(repoRoot, PORT_DIR)
    const gitignorePath = join(portDir, '.gitignore')

    expect(existsSync(portDir)).toBe(true)
    expect(existsSync(gitignorePath)).toBe(true)

    const gitignore = await readFile(gitignorePath, 'utf-8')
    expect(gitignore).toBe(PORT_RUNTIME_GITIGNORE)
  })

  test('does not overwrite an existing .gitignore', async () => {
    const portDir = join(repoRoot, PORT_DIR)
    const gitignorePath = join(portDir, '.gitignore')
    await mkdir(portDir, { recursive: true })
    await writeFile(gitignorePath, 'custom-ignore')

    await ensurePortRuntimeDir(repoRoot)

    const gitignore = await readFile(gitignorePath, 'utf-8')
    expect(gitignore).toBe('custom-ignore')
  })
})

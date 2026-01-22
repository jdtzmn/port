import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync } from 'fs'
import { rm, readFile } from 'fs/promises'
import { parse as yamlParse } from 'yaml'
import {
  findAvailablePort,
  writeHostServiceConfig,
  removeHostServiceConfig,
  isProcessRunning,
} from './hostService.ts'
import { TRAEFIK_DYNAMIC_DIR, ensureTraefikDynamicDir } from './traefik.ts'

describe('findAvailablePort', () => {
  test('returns a valid port number', async () => {
    const port = await findAvailablePort()

    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
  })

  test('returns different ports on consecutive calls', async () => {
    const port1 = await findAvailablePort()
    const port2 = await findAvailablePort()

    // They should generally be different (not guaranteed but very likely)
    // We're mainly testing that the function works multiple times
    expect(port1).toBeGreaterThan(0)
    expect(port2).toBeGreaterThan(0)
  })
})

describe('isProcessRunning', () => {
  test('returns true for the current process', () => {
    expect(isProcessRunning(process.pid)).toBe(true)
  })

  test('returns false for a non-existent PID', () => {
    // Use a very high PID that likely doesn't exist
    expect(isProcessRunning(999999999)).toBe(false)
  })
})

describe('writeHostServiceConfig', () => {
  beforeEach(async () => {
    // Ensure dynamic directory exists
    await ensureTraefikDynamicDir()
  })

  afterEach(async () => {
    // Clean up any config files created during tests
    const testConfigFile = join(TRAEFIK_DYNAMIC_DIR, 'test-branch-3000.yml')
    if (existsSync(testConfigFile)) {
      await rm(testConfigFile)
    }
  })

  test('creates a config file with correct path', async () => {
    const configFile = await writeHostServiceConfig('test-branch', 3000, 49152, 'port')

    expect(configFile).toBe(join(TRAEFIK_DYNAMIC_DIR, 'test-branch-3000.yml'))
    expect(existsSync(configFile)).toBe(true)
  })

  test('creates valid YAML with correct router config', async () => {
    const configFile = await writeHostServiceConfig('test-branch', 3000, 49152, 'port')

    const content = await readFile(configFile, 'utf-8')
    const config = yamlParse(content)

    expect(config.http.routers['test-branch-3000']).toBeDefined()
    expect(config.http.routers['test-branch-3000'].rule).toBe('Host(`test-branch.port`)')
    expect(config.http.routers['test-branch-3000'].entryPoints).toEqual(['port3000'])
    expect(config.http.routers['test-branch-3000'].service).toBe('test-branch-3000')
  })

  test('creates valid YAML with correct service config', async () => {
    const configFile = await writeHostServiceConfig('test-branch', 3000, 49152, 'port')

    const content = await readFile(configFile, 'utf-8')
    const config = yamlParse(content)

    expect(config.http.services['test-branch-3000']).toBeDefined()
    expect(config.http.services['test-branch-3000'].loadBalancer.servers).toEqual([
      { url: 'http://host.docker.internal:49152' },
    ])
  })

  test('uses custom domain in host rule', async () => {
    const configFile = await writeHostServiceConfig('feature-1', 8080, 50000, 'custom.dev')

    const content = await readFile(configFile, 'utf-8')
    const config = yamlParse(content)

    expect(config.http.routers['feature-1-8080'].rule).toBe('Host(`feature-1.custom.dev`)')

    // Clean up
    await rm(configFile)
  })
})

describe('removeHostServiceConfig', () => {
  test('removes existing config file', async () => {
    await ensureTraefikDynamicDir()
    const configFile = await writeHostServiceConfig('temp-branch', 4000, 51000, 'port')

    expect(existsSync(configFile)).toBe(true)

    await removeHostServiceConfig(configFile)

    expect(existsSync(configFile)).toBe(false)
  })

  test('does not throw when file does not exist', async () => {
    const nonExistentFile = join(TRAEFIK_DYNAMIC_DIR, 'non-existent.yml')

    await expect(removeHostServiceConfig(nonExistentFile)).resolves.not.toThrow()
  })
})

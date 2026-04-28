import { readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { describe, test, expect, beforeAll, beforeEach } from 'vitest'
import { useIsolatedPortGlobalDir } from '@tests/isolatedGlobalDir'

type TraefikModule = typeof import('./traefik.ts')

let traefik: TraefikModule

describe('Traefik state concurrency', () => {
  useIsolatedPortGlobalDir('port-traefik-test', { resetModules: true })

  beforeAll(async () => {
    traefik = await import('./traefik.ts')
  })

  beforeEach(async () => {
    await rm(traefik.TRAEFIK_DIR, { recursive: true, force: true })
  })

  test('keeps all ports when ensureTraefikPorts runs concurrently', async () => {
    const ports = [3101, 3102, 3103, 3104, 3105]

    await Promise.all(ports.map(port => traefik.ensureTraefikPorts([port])))

    const configuredPorts = await traefik.getConfiguredPorts()
    expect(configuredPorts).toEqual(ports)

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')
    for (const port of ports) {
      expect(composeContent).toContain(`${port}:${port}`)
    }
  })

  test('keeps all ports when addPortsToConfig runs concurrently', async () => {
    const ports = [3201, 3202, 3203, 3204, 3205]

    await Promise.all(ports.map(port => traefik.addPortsToConfig([port])))

    const configuredPorts = await traefik.getConfiguredPorts()
    expect(configuredPorts).toEqual(ports)
  })
})

describe('Traefik 404 handler', () => {
  useIsolatedPortGlobalDir('port-traefik-404-test', { resetModules: true })

  beforeAll(async () => {
    traefik = await import('./traefik.ts')
  })

  beforeEach(async () => {
    await rm(traefik.TRAEFIK_DIR, { recursive: true, force: true })
  })

  test('generates 404 error page config with correct structure', () => {
    const config = traefik.generate404ErrorPageConfig()

    expect(config).toContain('error-pages')
    expect(config).toContain('port-404-handler')
    expect(config).toContain('status:')
    expect(config).toContain('404')
    expect(config).toContain('http://port-404-handler:3000')
  })

  test('generates catch-all router with low priority', () => {
    const config = traefik.generate404ErrorPageConfig()

    // Check for router definition
    expect(config).toContain('routers:')
    expect(config).toContain('port-404-fallback')

    // Check router has catch-all rule
    expect(config).toContain('rule:')
    expect(config).toContain('PathPrefix(`/`)')

    // Check low priority (priority: 1 is lowest)
    expect(config).toContain('priority: 1')

    // Check router routes to service
    expect(config).toContain('service: port-404-handler')

    // Check router uses web entrypoint
    expect(config).toContain('entryPoints:')
    expect(config).toContain('- web')
  })

  test('catch-all router routes to correct service', () => {
    const config = traefik.generate404ErrorPageConfig()

    // Verify service definition exists
    expect(config).toContain('services:')
    expect(config).toContain('port-404-handler:')
    expect(config).toContain('loadBalancer:')
    expect(config).toContain('servers:')
    expect(config).toContain('url: http://port-404-handler:3000')
  })

  test('ensure404Handler creates config file', async () => {
    await traefik.ensureTraefikDynamicDir()

    const created = await traefik.ensure404Handler()

    expect(created).toBe(true)
    expect(existsSync(traefik.ERROR_PAGE_CONFIG_FILE)).toBe(true)

    const content = await readFile(traefik.ERROR_PAGE_CONFIG_FILE, 'utf-8')
    expect(content).toContain('error-pages')
    expect(content).toContain('port-404-handler')
  })

  test('ensure404Handler does not overwrite existing config', async () => {
    await traefik.ensureTraefikDynamicDir()

    const firstCreate = await traefik.ensure404Handler()
    expect(firstCreate).toBe(true)

    const secondCreate = await traefik.ensure404Handler()
    expect(secondCreate).toBe(false)
  })

  test('generated compose includes 404 handler service with ghcr.io image', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    expect(composeContent).toContain('port-404-handler')
    expect(composeContent).toContain('ghcr.io/jdtzmn/port-404-handler:')
    expect(composeContent).not.toContain('alpine:latest')
    expect(composeContent).not.toContain('socat')
  })

  test('404 handler mounts Docker socket for container inspection', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    expect(composeContent).toContain('/var/run/docker.sock:/var/run/docker.sock')
  })

  test('404 handler compose service has no inline command', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    // The logic now lives in the Docker image, not in an inline shell command
    expect(composeContent).not.toContain('docker ps')
    expect(composeContent).not.toContain('socat')
  })
})

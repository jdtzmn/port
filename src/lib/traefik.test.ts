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

  test('generated compose includes 404 handler service', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    expect(composeContent).toContain('port-404-handler')
    expect(composeContent).toContain('alpine:latest')
    expect(composeContent).toContain('socat')
    expect(composeContent).toContain('Worktree Not')
  })

  test('404 handler command includes worktree discovery logic', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    // Verify command queries Docker for traefik.enable labels
    expect(composeContent).toContain('docker ps')
    expect(composeContent).toContain('traefik.enable=true')
    
    // Verify it extracts Host rules to find worktree names
    expect(composeContent).toContain('Host(')
    
    // Verify it provides empty state text when no worktrees are running
    // The text appears in the command string (may be escaped in YAML)
    expect(composeContent).toMatch(/No\s+running worktrees/)
    
    // Verify it lists worktrees when they exist
    expect(composeContent).toMatch(/Running worktrees:/)
  })

  test('404 handler returns plain-text response', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    // Verify HTTP response headers for plain text
    expect(composeContent).toContain('Content-Type: text/plain')
    // The 404 message appears in the command (may have escaped newlines)
    expect(composeContent).toMatch(/404.*Worktree Not\s+Found/)
  })

  test('404 handler mounts Docker socket for container inspection', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    // Verify handler has access to Docker socket to query running containers
    expect(composeContent).toContain('/var/run/docker.sock:/var/run/docker.sock')
  })

  test('V1 custom 404 output contract covers both running and empty states', async () => {
    await traefik.initTraefikFiles([3000])

    const composeContent = await readFile(traefik.TRAEFIK_COMPOSE_FILE, 'utf-8')

    // V1 contract: HTTP 404 status line (matches across line breaks in YAML)
    expect(composeContent).toMatch(/HTTP\/1\.1 404 Not[\s\S]*?Found/)
    
    // V1 contract: Plain text content type header
    expect(composeContent).toMatch(/Content-Type:\s*text\/plain/)
    
    // V1 contract: First line body is always "404 - Worktree Not Found"
    expect(composeContent).toMatch(/404\s*-\s*Worktree Not[\s\S]*?Found/)

    // V1 contract: Empty state branch - "No running worktrees" when no containers found
    // (matches across YAML line wrapping)
    expect(composeContent).toMatch(/No[\s\n]*running worktrees/)
    
    // V1 contract: Non-empty state branch - "Running worktrees:" header followed by list
    expect(composeContent).toMatch(/Running worktrees:/)
    
    // Verify the conditional logic exists (if-else structure for both branches)
    // Variables may be escaped in YAML string context (e.g., \\\"$WORKTREES\\\")
    expect(composeContent).toMatch(/if \[ -z [\\]*["']?\$WORKTREES[\\]*["']? \]/)
    expect(composeContent).toContain('else')
  })
})

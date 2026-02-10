import { readFile, rm } from 'fs/promises'
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

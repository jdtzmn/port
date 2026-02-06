import { readFile, rm } from 'fs/promises'
import { describe, test, expect, beforeEach } from 'vitest'
import {
  TRAEFIK_DIR,
  TRAEFIK_COMPOSE_FILE,
  addPortsToConfig,
  ensureTraefikPorts,
  getConfiguredPorts,
} from './traefik.ts'

describe('Traefik state concurrency', () => {
  beforeEach(async () => {
    await rm(TRAEFIK_DIR, { recursive: true, force: true })
  })

  test('keeps all ports when ensureTraefikPorts runs concurrently', async () => {
    const ports = [3101, 3102, 3103, 3104, 3105]

    await Promise.all(ports.map(port => ensureTraefikPorts([port])))

    const configuredPorts = await getConfiguredPorts()
    expect(configuredPorts).toEqual(ports)

    const composeContent = await readFile(TRAEFIK_COMPOSE_FILE, 'utf-8')
    for (const port of ports) {
      expect(composeContent).toContain(`${port}:${port}`)
    }
  })

  test('keeps all ports when addPortsToConfig runs concurrently', async () => {
    const ports = [3201, 3202, 3203, 3204, 3205]

    await Promise.all(ports.map(port => addPortsToConfig([port])))

    const configuredPorts = await getConfiguredPorts()
    expect(configuredPorts).toEqual(ports)
  })
})

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { stringify as yamlStringify, parse as yamlParse } from 'yaml'
import { GLOBAL_PORT_DIR, ensureGlobalDir } from './registry.ts'
import type { TraefikConfig } from '../types.ts'

/** Traefik directory within global port dir */
export const TRAEFIK_DIR = join(GLOBAL_PORT_DIR, 'traefik')

/** Traefik static config file */
export const TRAEFIK_CONFIG_FILE = join(TRAEFIK_DIR, 'traefik.yml')

/** Traefik docker-compose file */
export const TRAEFIK_COMPOSE_FILE = join(TRAEFIK_DIR, 'docker-compose.yml')

/** Traefik dynamic config directory */
export const TRAEFIK_DYNAMIC_DIR = join(TRAEFIK_DIR, 'dynamic')

/** Traefik network name */
export const TRAEFIK_NETWORK = 'traefik-network'

/**
 * Ensure the traefik directory exists
 */
export async function ensureTraefikDir(): Promise<void> {
  await ensureGlobalDir()
  if (!existsSync(TRAEFIK_DIR)) {
    await mkdir(TRAEFIK_DIR, { recursive: true })
  }
}

/**
 * Ensure the traefik dynamic directory exists
 */
export async function ensureTraefikDynamicDir(): Promise<void> {
  await ensureTraefikDir()
  if (!existsSync(TRAEFIK_DYNAMIC_DIR)) {
    await mkdir(TRAEFIK_DYNAMIC_DIR, { recursive: true })
  }
}

/**
 * Generate the base Traefik static configuration
 *
 * @param ports - Array of ports to create entrypoints for
 * @returns TraefikConfig object
 */
export function generateTraefikConfig(ports: number[]): TraefikConfig {
  const entryPoints: Record<string, { address: string }> = {
    web: { address: ':80' },
  }

  // Add entrypoint for each port
  for (const port of ports) {
    entryPoints[`port${port}`] = { address: `:${port}` }
  }

  return {
    api: {
      dashboard: true,
      insecure: false,
    },
    providers: {
      docker: {
        exposedByDefault: false,
        network: TRAEFIK_NETWORK,
      },
      file: {
        directory: '/etc/traefik/dynamic',
        watch: true,
      },
    },
    entryPoints,
  }
}

/**
 * Load the current Traefik configuration
 *
 * @returns The current config or null if it doesn't exist
 */
export async function loadTraefikConfig(): Promise<TraefikConfig | null> {
  if (!existsSync(TRAEFIK_CONFIG_FILE)) {
    return null
  }

  try {
    const content = await readFile(TRAEFIK_CONFIG_FILE, 'utf-8')
    return yamlParse(content) as TraefikConfig
  } catch {
    return null
  }
}

/**
 * Save Traefik configuration to disk
 *
 * @param config - The configuration to save
 */
export async function saveTraefikConfig(config: TraefikConfig): Promise<void> {
  await ensureTraefikDir()
  const yaml = yamlStringify(config)
  await writeFile(TRAEFIK_CONFIG_FILE, yaml)
}

/**
 * Get the ports that have entrypoints configured in Traefik
 *
 * @returns Array of port numbers with existing entrypoints
 */
export async function getConfiguredPorts(): Promise<number[]> {
  const config = await loadTraefikConfig()
  if (!config?.entryPoints) {
    return []
  }

  const ports: number[] = []
  for (const [name, entrypoint] of Object.entries(config.entryPoints)) {
    // Skip non-port entrypoints (like 'web')
    if (!name.startsWith('port')) continue

    // Extract port from address (e.g., ':3000' -> 3000)
    const match = entrypoint.address.match(/:(\d+)$/)
    if (match?.[1]) {
      ports.push(parseInt(match[1], 10))
    }
  }

  return ports.sort((a, b) => a - b)
}

/**
 * Check if Traefik config needs to be updated with new ports
 *
 * @param requiredPorts - Ports that need to be configured
 * @returns Array of missing ports that need to be added
 */
export async function getMissingPorts(requiredPorts: number[]): Promise<number[]> {
  const configuredPorts = await getConfiguredPorts()
  return requiredPorts.filter(port => !configuredPorts.includes(port))
}

/**
 * Update Traefik config to include new ports
 * Preserves existing entrypoints and adds new ones
 *
 * @param newPorts - New ports to add
 */
export async function addPortsToConfig(newPorts: number[]): Promise<void> {
  let config = await loadTraefikConfig()

  if (!config) {
    // Create new config with all ports
    config = generateTraefikConfig(newPorts)
  } else {
    // Add new entrypoints
    for (const port of newPorts) {
      config.entryPoints[`port${port}`] = { address: `:${port}` }
    }

    // Ensure file provider is configured (for host services)
    if (!config.providers.file) {
      config.providers.file = {
        directory: '/etc/traefik/dynamic',
        watch: true,
      }
    }
  }

  await saveTraefikConfig(config)
}

/**
 * Generate the Traefik docker-compose.yml content
 *
 * @returns The docker-compose content as a string
 */
export function generateTraefikCompose(): string {
  const compose = {
    services: {
      traefik: {
        image: 'traefik:v3.0',
        container_name: 'port-traefik',
        restart: 'unless-stopped',
        ports: ['80:80'],
        volumes: [
          '/var/run/docker.sock:/var/run/docker.sock:ro',
          './traefik.yml:/etc/traefik/traefik.yml:ro',
        ],
        networks: [TRAEFIK_NETWORK],
      },
    },
    networks: {
      [TRAEFIK_NETWORK]: {
        external: true,
      },
    },
  }

  return yamlStringify(compose)
}

/**
 * Update the Traefik docker-compose.yml to expose required ports
 *
 * @param ports - All ports that need to be exposed
 */
export async function updateTraefikCompose(ports: number[]): Promise<void> {
  await ensureTraefikDir()
  await ensureTraefikDynamicDir()

  // Generate port mappings
  const portMappings = ['80:80']
  for (const port of ports) {
    portMappings.push(`${port}:${port}`)
  }

  const compose = {
    services: {
      traefik: {
        image: 'traefik:v3.0',
        container_name: 'port-traefik',
        restart: 'unless-stopped',
        ports: portMappings,
        extra_hosts: ['host.docker.internal:host-gateway'],
        volumes: [
          '/var/run/docker.sock:/var/run/docker.sock:ro',
          './traefik.yml:/etc/traefik/traefik.yml:ro',
          './dynamic:/etc/traefik/dynamic:ro',
        ],
        networks: [TRAEFIK_NETWORK],
      },
    },
    networks: {
      [TRAEFIK_NETWORK]: {
        external: true,
      },
    },
  }

  await writeFile(TRAEFIK_COMPOSE_FILE, yamlStringify(compose))
}

/**
 * Check if Traefik files exist
 *
 * @returns true if both config and compose files exist
 */
export function traefikFilesExist(): boolean {
  return existsSync(TRAEFIK_CONFIG_FILE) && existsSync(TRAEFIK_COMPOSE_FILE)
}

/**
 * Initialize Traefik configuration files if they don't exist
 *
 * @param ports - Initial ports to configure
 */
export async function initTraefikFiles(ports: number[]): Promise<void> {
  await ensureTraefikDir()

  if (!existsSync(TRAEFIK_CONFIG_FILE)) {
    const config = generateTraefikConfig(ports)
    await saveTraefikConfig(config)
  }

  if (!existsSync(TRAEFIK_COMPOSE_FILE)) {
    await updateTraefikCompose(ports)
  }
}

/**
 * Check if Traefik config has file provider enabled
 *
 * @returns true if file provider is configured
 */
export async function hasFileProvider(): Promise<boolean> {
  const config = await loadTraefikConfig()
  return config?.providers?.file !== undefined
}

/**
 * Ensure the file provider is configured in Traefik
 * Needed for host services to work
 *
 * @returns true if config was updated
 */
export async function ensureFileProvider(): Promise<boolean> {
  const config = await loadTraefikConfig()

  if (!config) {
    return false // No config to update
  }

  if (config.providers.file) {
    return false // Already has file provider
  }

  // Add file provider
  config.providers.file = {
    directory: '/etc/traefik/dynamic',
    watch: true,
  }

  await saveTraefikConfig(config)

  // Also update compose to mount the dynamic directory
  const configuredPorts = await getConfiguredPorts()
  await updateTraefikCompose(configuredPorts)

  return true
}

/**
 * Ensure Traefik is configured with all required ports
 * Updates config and compose if new ports are needed
 *
 * @param requiredPorts - Ports that must be available
 * @returns true if configuration was updated
 */
export async function ensureTraefikPorts(requiredPorts: number[]): Promise<boolean> {
  const missingPorts = await getMissingPorts(requiredPorts)
  const needsFileProvider = !(await hasFileProvider())

  if (missingPorts.length === 0 && traefikFilesExist() && !needsFileProvider) {
    return false
  }

  // Get all ports (existing + new)
  const configuredPorts = await getConfiguredPorts()
  const allPorts = [...new Set([...configuredPorts, ...requiredPorts])].sort((a, b) => a - b)

  // Update both config and compose
  const config = generateTraefikConfig(allPorts)
  await saveTraefikConfig(config)
  await updateTraefikCompose(allPorts)

  return true
}

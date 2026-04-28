import { readFile, mkdir } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { stringify as yamlStringify, parse as yamlParse } from 'yaml'
import { GLOBAL_PORT_DIR, ensureGlobalDir } from './registry.ts'
import type { TraefikConfig } from '../types.ts'
import { withFileLock, writeFileAtomic } from './state.ts'
import { execAsync } from './exec.ts'

/** Traefik directory within global port dir */
export const TRAEFIK_DIR = join(GLOBAL_PORT_DIR, 'traefik')

/** Traefik static config file */
export const TRAEFIK_CONFIG_FILE = join(TRAEFIK_DIR, 'traefik.yml')

/** Traefik docker-compose file */
export const TRAEFIK_COMPOSE_FILE = join(TRAEFIK_DIR, 'docker-compose.yml')

/** Traefik dynamic config directory */
export const TRAEFIK_DYNAMIC_DIR = join(TRAEFIK_DIR, 'dynamic')

/** Traefik state lock file */
export const TRAEFIK_LOCK_FILE = join(GLOBAL_PORT_DIR, 'traefik.lock')

/** Traefik network name */
export const TRAEFIK_NETWORK = 'traefik-network'

async function withTraefikLock<T>(callback: () => Promise<T>): Promise<T> {
  await ensureGlobalDir()
  return withFileLock(TRAEFIK_LOCK_FILE, callback)
}

async function saveTraefikConfigUnlocked(config: TraefikConfig): Promise<void> {
  await ensureTraefikDir()
  const yaml = yamlStringify(config)
  await writeFileAtomic(TRAEFIK_CONFIG_FILE, yaml)
}

/**
 * Get the versioned Docker image name for the 404 handler.
 * Reads version from package.json to stay in sync with the published npm package.
 *
 * Tries candidate paths relative to import.meta.url to handle both running
 * from compiled dist/ output (one level up) and from source src/lib/ (two levels up).
 */
function get404HandlerImage(): string {
  const candidates = ['../package.json', '../../package.json']
  for (const candidate of candidates) {
    try {
      const packageJsonPath = fileURLToPath(new URL(candidate, import.meta.url))
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        version?: unknown
        name?: unknown
      }
      // Ensure we found the root package.json (not some other package.json)
      if (typeof packageJson.version === 'string' && packageJson.name === '@jdtzmn/port') {
        return `ghcr.io/jdtzmn/port-404-handler:${packageJson.version}`
      }
    } catch {
      // Try next candidate
    }
  }
  return 'ghcr.io/jdtzmn/port-404-handler:latest'
}

/**
 * Ensure the 404 handler Docker image is available locally.
 *
 * When running from source (packages/404-app/Dockerfile exists next to dist/),
 * builds the image locally if it isn't already present. When installed via npm,
 * the Dockerfile won't exist and Docker will pull from ghcr.io as normal.
 *
 * @param onBuilding - Optional callback invoked just before the build starts
 * @param onBuilt - Optional callback invoked after a successful build
 */
export async function ensure404HandlerImage(
  onBuilding?: () => void,
  onBuilt?: () => void
): Promise<void> {
  const image = get404HandlerImage()
  const dockerfilePath = fileURLToPath(new URL('../packages/404-app/Dockerfile', import.meta.url))

  if (!existsSync(dockerfilePath)) {
    // Not running from source — image should be available on ghcr.io for this release
    return
  }

  // Check if the image already exists locally
  try {
    await execAsync(`docker image inspect ${image}`)
    return // already built, nothing to do
  } catch {
    // Not found locally — build it
  }

  onBuilding?.()
  const contextPath = fileURLToPath(new URL('../packages/404-app', import.meta.url))
  await execAsync(`docker build -t ${image} "${contextPath}"`)
  onBuilt?.()
}

async function updateTraefikComposeUnlocked(ports: number[]): Promise<void> {
  await ensureTraefikDir()
  await ensureTraefikDynamicDir()

  const portMappings = ['80:80']
  for (const port of ports) {
    portMappings.push(`${port}:${port}`)
  }

  const compose = {
    services: {
      traefik: {
        image: 'traefik:v3.6',
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
      'port-404-handler': {
        image: get404HandlerImage(),
        container_name: 'port-404-handler',
        restart: 'unless-stopped',
        volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        networks: [TRAEFIK_NETWORK],
      },
    },
    networks: {
      [TRAEFIK_NETWORK]: {
        external: true,
      },
    },
  }

  await writeFileAtomic(TRAEFIK_COMPOSE_FILE, yamlStringify(compose))
}

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
  await withTraefikLock(async () => {
    await saveTraefikConfigUnlocked(config)
  })
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
  await withTraefikLock(async () => {
    let config = await loadTraefikConfig()

    if (!config) {
      config = generateTraefikConfig(newPorts)
    } else {
      for (const port of newPorts) {
        config.entryPoints[`port${port}`] = { address: `:${port}` }
      }

      if (!config.providers.file) {
        config.providers.file = {
          directory: '/etc/traefik/dynamic',
          watch: true,
        }
      }
    }

    await saveTraefikConfigUnlocked(config)
  })
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
        image: 'traefik:v3.6',
        container_name: 'port-traefik',
        restart: 'unless-stopped',
        ports: ['80:80'],
        volumes: [
          '/var/run/docker.sock:/var/run/docker.sock:ro',
          './traefik.yml:/etc/traefik/traefik.yml:ro',
          './dynamic:/etc/traefik/dynamic:ro',
        ],
        networks: [TRAEFIK_NETWORK],
      },
      'port-404-handler': {
        image: get404HandlerImage(),
        container_name: 'port-404-handler',
        restart: 'unless-stopped',
        volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
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
  await withTraefikLock(async () => {
    await updateTraefikComposeUnlocked(ports)
  })
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
  await withTraefikLock(async () => {
    await ensureTraefikDir()

    if (!existsSync(TRAEFIK_CONFIG_FILE)) {
      const config = generateTraefikConfig(ports)
      await saveTraefikConfigUnlocked(config)
    }

    await updateTraefikComposeUnlocked(ports)
  })
  await ensure404Handler()
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
 * Generate dynamic config for 404 error page handler
 *
 * Includes:
 * - A catch-all router with low priority to handle unmatched hosts/paths
 * - A service pointing to the port-404-handler container
 * - Middleware for error page handling (optional, router provides main fallback)
 *
 * @returns Dynamic config YAML string for error pages
 */
export function generate404ErrorPageConfig(): string {
  const config = {
    http: {
      routers: {
        'port-404-fallback': {
          rule: 'PathPrefix(`/`)',
          priority: 1,
          service: 'port-404-handler',
          entryPoints: ['web'],
        },
      },
      middlewares: {
        'error-pages': {
          errors: {
            status: ['404'],
            service: 'port-404-handler',
            query: '/{status}',
          },
        },
      },
      services: {
        'port-404-handler': {
          loadBalancer: {
            servers: [
              {
                url: 'http://port-404-handler:3000',
              },
            ],
          },
        },
      },
    },
  }

  return yamlStringify(config)
}

/**
 * Path to the 404 error page dynamic config file
 */
export const ERROR_PAGE_CONFIG_FILE = join(TRAEFIK_DYNAMIC_DIR, '404-handler.yml')

/**
 * Ensure 404 error page handler is configured
 * Creates the dynamic config file if it doesn't exist
 *
 * @returns true if config was created
 */
export async function ensure404Handler(): Promise<boolean> {
  await ensureTraefikDynamicDir()

  if (existsSync(ERROR_PAGE_CONFIG_FILE)) {
    return false
  }

  const config = generate404ErrorPageConfig()
  await writeFileAtomic(ERROR_PAGE_CONFIG_FILE, config)
  return true
}

/**
 * Ensure the file provider is configured in Traefik
 * Needed for host services to work
 *
 * @returns true if config was updated
 */
export async function ensureFileProvider(): Promise<boolean> {
  return withTraefikLock(async () => {
    const config = await loadTraefikConfig()

    if (!config) {
      return false
    }

    if (config.providers.file) {
      return false
    }

    config.providers.file = {
      directory: '/etc/traefik/dynamic',
      watch: true,
    }

    await saveTraefikConfigUnlocked(config)

    const configuredPorts = await getConfiguredPorts()
    await updateTraefikComposeUnlocked(configuredPorts)

    return true
  })
}

/**
 * Check whether the on-disk Traefik docker-compose.yml is missing the
 * `port-404-handler` service, or has it pinned to an image other than the
 * one we'd generate for this build of port.
 *
 * Returns `true` when the compose file needs to be rewritten so Traefik can
 * actually serve the friendly 404 page. Returns `false` only when the service
 * is present and pinned to the exact expected image string.
 *
 * Any read or YAML-parse failure is treated as "needs update" — better to
 * regenerate a corrupt or unreadable file than to silently leave it broken.
 */
export async function composeNeeds404HandlerUpdate(): Promise<boolean> {
  if (!existsSync(TRAEFIK_COMPOSE_FILE)) {
    return true
  }

  let parsed: unknown
  try {
    const content = await readFile(TRAEFIK_COMPOSE_FILE, 'utf-8')
    parsed = yamlParse(content)
  } catch {
    return true
  }

  const services = (parsed as { services?: Record<string, { image?: unknown }> } | null)?.services
  const handler = services?.['port-404-handler']
  if (!handler || typeof handler.image !== 'string') {
    return true
  }

  return handler.image !== get404HandlerImage()
}

/**
 * Ensure Traefik is configured with all required ports
 * Updates config and compose if new ports are needed
 *
 * @param requiredPorts - Ports that must be available
 * @returns true if configuration was updated
 */
export async function ensureTraefikPorts(requiredPorts: number[]): Promise<boolean> {
  const needsRestart = await withTraefikLock(async () => {
    const missingPorts = await getMissingPorts(requiredPorts)
    const needsFileProvider = !(await hasFileProvider())

    // Fast path: nothing to change. Skip rewriting config + compose so that
    // concurrent `port up` invocations (e.g. parallel test workers) don't
    // serialize on the traefik lock for no-op work.
    if (missingPorts.length === 0 && traefikFilesExist() && !needsFileProvider) {
      return false
    }

    const configuredPorts = await getConfiguredPorts()
    const allPorts = [...new Set([...configuredPorts, ...requiredPorts])].sort((a, b) => a - b)

    const config = generateTraefikConfig(allPorts)
    await saveTraefikConfigUnlocked(config)
    await updateTraefikComposeUnlocked(allPorts)

    return true
  })
  // ensure404Handler is idempotent (early-returns if the dynamic config file
  // already exists), so calling it on every `port up` is cheap.
  await ensure404Handler()
  return needsRestart
}

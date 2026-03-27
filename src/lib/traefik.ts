import { readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { stringify as yamlStringify, parse as yamlParse } from 'yaml'
import { GLOBAL_PORT_DIR, ensureGlobalDir } from './registry.ts'
import type { TraefikConfig } from '../types.ts'
import { withFileLock, writeFileAtomic } from './state.ts'

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
 * Generate the 404 handler command that dynamically lists running worktrees
 */
function generate404HandlerCommand(): string {
  // This shell script:
  // 1. Installs socat and docker-cli
  // 2. Runs an HTTP server on port 3000
  // 3. For each request, queries Docker for containers with traefik.enable=true
  // 4. Extracts worktree names from Host() rules in Traefik labels
  // 5. Returns a plain-text response listing running worktrees or "No running worktrees"

  const innerScript = [
    'echo "HTTP/1.1 404 Not Found\\r\\nContent-Type: text/plain\\r\\n\\r\\n404 - Worktree Not Found\\r\\n\\r\\n";',
    'WORKTREES=$(docker ps --filter "label=traefik.enable=true" --format "{{.Labels}}" 2>/dev/null | grep -o "Host(\\\\`[^\\\\`]*\\\\`)" | sed "s/Host(\\\\`//g; s/\\\\`)//g; s/\\\\.[^.]*$//g" | sort -u);',
    'if [ -z "$WORKTREES" ]; then',
    '  echo "No running worktrees";',
    'else',
    '  echo "Running worktrees:";',
    '  echo "$WORKTREES";',
    'fi',
  ].join(' ')

  // eslint-disable-next-line no-useless-escape
  return `sh -c "apk add --no-cache socat docker-cli && while true; do socat -v TCP-LISTEN:3000,reuseaddr,fork SYSTEM:'sh -c \"${innerScript}\"'; done"`
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
        image: 'alpine:latest',
        container_name: 'port-404-handler',
        restart: 'unless-stopped',
        command: generate404HandlerCommand(),
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
        image: 'alpine:latest',
        container_name: 'port-404-handler',
        restart: 'unless-stopped',
        command: generate404HandlerCommand(),
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

    if (!existsSync(TRAEFIK_COMPOSE_FILE)) {
      await updateTraefikComposeUnlocked(ports)
    }
  })
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
 * Ensure Traefik is configured with all required ports
 * Updates config and compose if new ports are needed
 *
 * @param requiredPorts - Ports that must be available
 * @returns true if configuration was updated
 */
export async function ensureTraefikPorts(requiredPorts: number[]): Promise<boolean> {
  return withTraefikLock(async () => {
    const missingPorts = await getMissingPorts(requiredPorts)
    const needsFileProvider = !(await hasFileProvider())

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
}

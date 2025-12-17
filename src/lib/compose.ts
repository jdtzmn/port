import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { stringify as yamlStringify } from 'yaml'
import type { PortConfig } from '../types.ts'
import { TRAEFIK_NETWORK, TRAEFIK_DIR } from './traefik.ts'

const execAsync = promisify(exec)

/** Override file name */
export const OVERRIDE_FILE = 'docker-compose.override.yml'

/**
 * Error thrown when docker-compose operations fail
 */
export class ComposeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComposeError'
  }
}

/**
 * Check docker-compose version
 *
 * @returns Version string or null if not installed
 */
export async function getComposeVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('docker compose version --short')
    return stdout.trim()
  } catch {
    try {
      // Try legacy docker-compose command
      const { stdout } = await execAsync('docker-compose --version')
      const match = stdout.match(/(\d+\.\d+\.\d+)/)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }
}

/**
 * Check if docker-compose version supports !override
 * Requires v2.24.0 or later
 *
 * @returns true if version is sufficient
 */
export async function checkComposeVersion(): Promise<{
  supported: boolean
  version: string | null
}> {
  const version = await getComposeVersion()

  if (!version) {
    return { supported: false, version: null }
  }

  const parts = version.split('.').map(Number)
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0

  // v2.24.0+ required for !override
  const supported = major > 2 || (major === 2 && minor >= 24)

  return { supported, version }
}

/**
 * Generate Traefik labels for a service
 *
 * @param worktreeName - Sanitized worktree/branch name
 * @param serviceName - Name of the docker-compose service
 * @param port - Port to expose
 * @param domain - Domain suffix (default: 'port')
 * @returns Array of Traefik labels
 */
function generateTraefikLabels(
  worktreeName: string,
  serviceName: string,
  port: number,
  domain: string
): string[] {
  const routerName = `${worktreeName}-${serviceName}-${port}`
  const hostname = `${worktreeName}.${domain}`

  return [
    `traefik.http.routers.${routerName}.rule=Host(\`${hostname}\`)`,
    `traefik.http.routers.${routerName}.entrypoints=port${port}`,
    `traefik.http.services.${routerName}.loadbalancer.server.port=${port}`,
  ]
}

/**
 * Generate the docker-compose.override.yml content
 *
 * @param config - Port configuration
 * @param worktreeName - Sanitized worktree/branch name
 * @returns YAML string for the override file
 */
export function generateOverrideContent(config: PortConfig, worktreeName: string): string {
  const services: Record<string, unknown> = {}

  for (const service of config.services) {
    const labels = ['traefik.enable=true']

    // Add labels for each port
    for (const port of service.ports) {
      labels.push(...generateTraefikLabels(worktreeName, service.name, port, config.domain))
    }

    services[service.name] = {
      // Use !override to remove host port bindings
      // This is a YAML tag that tells docker-compose to replace rather than merge
      ports: [], // Will be prefixed with !override in output
      networks: [TRAEFIK_NETWORK],
      labels,
    }
  }

  const override = {
    services,
    networks: {
      [TRAEFIK_NETWORK]: {
        external: true,
        name: TRAEFIK_NETWORK,
      },
    },
  }

  // Generate YAML
  let yaml = yamlStringify(override)

  // Replace empty ports arrays with !override [] syntax
  // This is a workaround since the yaml library doesn't support custom tags
  yaml = yaml.replace(/ports: \[\]/g, 'ports: !override []')

  return yaml
}

/**
 * Write the docker-compose.override.yml file
 *
 * @param worktreePath - Path to the worktree directory
 * @param config - Port configuration
 * @param worktreeName - Sanitized worktree/branch name
 */
export async function writeOverrideFile(
  worktreePath: string,
  config: PortConfig,
  worktreeName: string
): Promise<void> {
  const content = generateOverrideContent(config, worktreeName)
  const overridePath = join(worktreePath, OVERRIDE_FILE)
  await writeFile(overridePath, content)
}

/**
 * Get the docker compose command (handles both v1 and v2)
 */
async function getComposeCommand(): Promise<string> {
  try {
    await execAsync('docker compose version')
    return 'docker compose'
  } catch {
    return 'docker-compose'
  }
}

/**
 * Run docker-compose up in a directory
 *
 * @param cwd - Working directory
 * @param composeFile - Path to docker-compose file
 * @param detached - Run in detached mode (default: true)
 */
export async function composeUp(
  cwd: string,
  composeFile: string,
  detached: boolean = true
): Promise<void> {
  const cmd = await getComposeCommand()
  const detachedFlag = detached ? '-d' : ''

  try {
    await execAsync(`${cmd} -f ${composeFile} -f ${OVERRIDE_FILE} up ${detachedFlag}`, {
      cwd,
      timeout: 120000, // 2 minute timeout
    })
  } catch (error) {
    throw new ComposeError(`Failed to start services: ${error}`)
  }
}

/**
 * Run docker-compose down in a directory
 *
 * @param cwd - Working directory
 * @param composeFile - Path to docker-compose file
 */
export async function composeDown(cwd: string, composeFile: string): Promise<void> {
  const cmd = await getComposeCommand()

  try {
    await execAsync(`${cmd} -f ${composeFile} -f ${OVERRIDE_FILE} down`, {
      cwd,
      timeout: 60000, // 1 minute timeout
    })
  } catch (error) {
    throw new ComposeError(`Failed to stop services: ${error}`)
  }
}

/**
 * Get status of docker-compose services
 *
 * @param cwd - Working directory
 * @param composeFile - Path to docker-compose file
 * @returns Array of service statuses
 */
export async function composePs(
  cwd: string,
  composeFile: string
): Promise<Array<{ name: string; status: string; running: boolean }>> {
  const cmd = await getComposeCommand()

  try {
    const { stdout } = await execAsync(
      `${cmd} -f ${composeFile} -f ${OVERRIDE_FILE} ps --format json`,
      { cwd }
    )

    if (!stdout.trim()) {
      return []
    }

    // docker compose ps --format json outputs one JSON object per line
    const lines = stdout.trim().split('\n')
    const services: Array<{ name: string; status: string; running: boolean }> = []

    for (const line of lines) {
      try {
        const service = JSON.parse(line)
        services.push({
          name: service.Service || service.Name || 'unknown',
          status: service.State || service.Status || 'unknown',
          running: (service.State || '').toLowerCase().includes('running'),
        })
      } catch {
        // Skip malformed lines
      }
    }

    return services
  } catch {
    return []
  }
}

/**
 * Start Traefik container
 */
export async function startTraefik(): Promise<void> {
  const cmd = await getComposeCommand()

  try {
    // Ensure the network exists
    await execAsync(`docker network create ${TRAEFIK_NETWORK} 2>/dev/null || true`)

    await execAsync(`${cmd} up -d`, {
      cwd: TRAEFIK_DIR,
      timeout: 60000,
    })
  } catch (error) {
    throw new ComposeError(`Failed to start Traefik: ${error}`)
  }
}

/**
 * Stop Traefik container
 */
export async function stopTraefik(): Promise<void> {
  const cmd = await getComposeCommand()

  try {
    await execAsync(`${cmd} down`, {
      cwd: TRAEFIK_DIR,
      timeout: 60000,
    })
  } catch (error) {
    throw new ComposeError(`Failed to stop Traefik: ${error}`)
  }
}

/**
 * Check if Traefik is running
 *
 * @returns true if Traefik container is running
 */
export async function isTraefikRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('docker ps --filter name=port-traefik --format "{{.Names}}"')
    return stdout.trim() === 'port-traefik'
  } catch {
    return false
  }
}

/**
 * Restart Traefik container (needed after config changes)
 */
export async function restartTraefik(): Promise<void> {
  const cmd = await getComposeCommand()

  try {
    await execAsync(`${cmd} restart`, {
      cwd: TRAEFIK_DIR,
      timeout: 60000,
    })
  } catch (error) {
    throw new ComposeError(`Failed to restart Traefik: ${error}`)
  }
}

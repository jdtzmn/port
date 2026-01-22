import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { stringify as yamlStringify } from 'yaml'
import type { ParsedComposeFile, ParsedComposeService } from '../types.ts'
import { TRAEFIK_NETWORK, TRAEFIK_DIR } from './traefik.ts'
import { execAsync } from './exec.ts'

/** Override file name */
export const OVERRIDE_FILE = 'override.yml'

/** Port directory for override files */
const PORT_DIR = '.port'

/**
 * Get the relative path to the override file from the worktree path
 * Used for docker compose -f flag
 *
 * For main repo: .port/override.yml
 * For worktrees: .port/override.yml (relative to worktree at .port/trees/<name>/)
 *
 * @returns Relative path to the override file
 */
export function getOverrideRelativePath(): string {
  return join(PORT_DIR, OVERRIDE_FILE)
}

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
 * Parse a docker-compose file using docker compose config
 *
 * @param cwd - Working directory containing the compose file
 * @param composeFile - Name of the compose file (default: docker-compose.yml)
 * @returns Parsed compose file structure
 */
export async function parseComposeFile(
  cwd: string,
  composeFile: string = 'docker-compose.yml'
): Promise<ParsedComposeFile> {
  const cmd = await getComposeCommand()

  try {
    const { stdout } = await execAsync(`${cmd} -f ${composeFile} config --format json`, {
      cwd,
      timeout: 30000,
    })

    return JSON.parse(stdout) as ParsedComposeFile
  } catch (error) {
    throw new ComposeError(`Failed to parse compose file: ${error}`)
  }
}

/**
 * Get all published ports from a parsed compose service
 *
 * @param service - Parsed compose service
 * @returns Array of published port numbers
 */
export function getServicePorts(service: ParsedComposeService): number[] {
  if (!service.ports || service.ports.length === 0) {
    return []
  }

  return service.ports
    .map(p => {
      // published can be string or number depending on docker compose version
      const port = typeof p.published === 'string' ? parseInt(p.published, 10) : p.published
      return port
    })
    .filter((port): port is number => typeof port === 'number' && !isNaN(port) && port > 0)
}

/**
 * Get all unique published ports from a parsed compose file
 *
 * @param composeFile - Parsed compose file
 * @returns Array of unique published port numbers, sorted
 */
export function getAllPorts(composeFile: ParsedComposeFile): number[] {
  const ports = new Set<number>()

  for (const service of Object.values(composeFile.services)) {
    for (const port of getServicePorts(service)) {
      ports.add(port)
    }
  }

  return Array.from(ports).sort((a, b) => a - b)
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
    `traefik.http.routers.${routerName}.service=${routerName}`,
    `traefik.http.services.${routerName}.loadbalancer.server.port=${port}`,
  ]
}

/**
 * Generate the docker-compose.override.yml content
 *
 * @param parsedCompose - Parsed compose file from docker compose config
 * @param worktreeName - Sanitized worktree/branch name
 * @param domain - Domain suffix (default: 'port')
 * @returns YAML string for the override file
 */
export function generateOverrideContent(
  parsedCompose: ParsedComposeFile,
  worktreeName: string,
  domain: string = 'port'
): string {
  const services: Record<string, unknown> = {}

  for (const [serviceName, service] of Object.entries(parsedCompose.services)) {
    const ports = getServicePorts(service)

    // Always add container_name to prevent conflicts
    const serviceOverride: Record<string, unknown> = {
      container_name: `${worktreeName}-${serviceName}`,
    }

    // Only add Traefik config for services with ports
    if (ports.length > 0) {
      const labels = ['traefik.enable=true']

      // Add labels for each port
      for (const port of ports) {
        labels.push(...generateTraefikLabels(worktreeName, serviceName, port, domain))
      }

      serviceOverride.ports = [] // Will be prefixed with !override in output
      serviceOverride.networks = [TRAEFIK_NETWORK]
      serviceOverride.labels = labels
    }

    services[serviceName] = serviceOverride
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
 * Write the override.yml file
 *
 * @param worktreePath - Path to the worktree directory (or repo root for main repo)
 * @param parsedCompose - Parsed compose file from docker compose config
 * @param worktreeName - Sanitized worktree/branch name
 * @param domain - Domain suffix (default: 'port')
 */
export async function writeOverrideFile(
  worktreePath: string,
  parsedCompose: ParsedComposeFile,
  worktreeName: string,
  domain: string = 'port'
): Promise<void> {
  const content = generateOverrideContent(parsedCompose, worktreeName, domain)
  const overridePath = join(worktreePath, PORT_DIR, OVERRIDE_FILE)
  // Ensure .port directory exists (for worktrees)
  await mkdir(join(worktreePath, PORT_DIR), { recursive: true })
  await writeFile(overridePath, content)
}

/**
 * Get the docker compose command (handles both v1 and v2)
 */
export async function getComposeCommand(): Promise<string> {
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
 * @param projectName - Project name for docker-compose (used for container naming)
 * @param detached - Run in detached mode (default: true)
 */
export async function composeUp(
  cwd: string,
  composeFile: string,
  projectName: string,
  detached: boolean = true
): Promise<void> {
  const cmd = await getComposeCommand()
  const detachedFlag = detached ? '-d' : ''
  const overridePath = getOverrideRelativePath()

  try {
    await execAsync(
      `${cmd} -p ${projectName} -f ${composeFile} -f ${overridePath} up ${detachedFlag}`,
      {
        cwd,
        timeout: 120000, // 2 minute timeout
      }
    )
  } catch (error) {
    throw new ComposeError(`Failed to start services: ${error}`)
  }
}

/**
 * Run docker-compose down in a directory
 *
 * @param cwd - Working directory
 * @param composeFile - Path to docker-compose file
 * @param projectName - Project name for docker-compose
 */
export async function composeDown(
  cwd: string,
  composeFile: string,
  projectName: string
): Promise<void> {
  const cmd = await getComposeCommand()
  const overridePath = getOverrideRelativePath()

  try {
    await execAsync(`${cmd} -p ${projectName} -f ${composeFile} -f ${overridePath} down`, {
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
 * @param projectName - Project name for docker-compose
 * @returns Array of service statuses
 */
export async function composePs(
  cwd: string,
  composeFile: string,
  projectName: string
): Promise<Array<{ name: string; status: string; running: boolean }>> {
  const cmd = await getComposeCommand()
  const overridePath = getOverrideRelativePath()

  try {
    const { stdout } = await execAsync(
      `${cmd} -p ${projectName} -f ${composeFile} -f ${overridePath} ps --format json`,
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
 *
 * This function handles concurrent starts gracefully - if another process
 * is already starting Traefik, we wait for it to complete rather than failing.
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
    // Check if the error is due to a concurrent start (container name conflict)
    const errorMessage = String(error)
    if (errorMessage.includes('is already in use')) {
      // Another process is starting Traefik - wait for it to be ready
      const maxWaitTime = 30000 // 30 seconds
      const pollInterval = 500 // 500ms
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        if (await isTraefikRunning()) {
          return // Traefik started successfully by another process
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }

      throw new ComposeError('Traefik startup timed out waiting for concurrent start')
    }

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

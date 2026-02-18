import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { stringify as yamlStringify } from 'yaml'
import type { ParsedComposeFile, ParsedComposeService } from '../types.ts'
import { TRAEFIK_NETWORK, TRAEFIK_DIR } from './traefik.ts'
import { execAsync, execWithStdio } from './exec.ts'
import { sanitizeFolderName } from './sanitize.ts'

/** Override file name */
export const OVERRIDE_FILE = 'override.yml'

/** User-editable compose override file name */
export const USER_OVERRIDE_COMPOSE_FILE = 'override-compose.yml'

/** Rendered compose override file name (generated) */
export const USER_OVERRIDE_RENDERED_FILE = 'override.user.yml'

/** Port directory for override files */
const PORT_DIR = '.port'

interface UserOverrideRenderContext {
  repoRoot: string
  worktreePath: string
  branch: string
  domain: string
  composeFile: string
  projectName: string
}

interface ComposeRuntimeContext {
  repoRoot: string
  branch: string
  domain: string
}

/**
 * Generate a unique docker-compose project name from repo root and worktree name.
 * This ensures containers from different repos with same-named worktrees don't conflict.
 *
 * @param repoRoot - Absolute path to the repo root
 * @param worktreeName - The worktree/branch name
 * @returns A unique project name like "my-repo-feature-branch"
 */
export function getProjectName(repoRoot: string, worktreeName: string): string {
  const repoName = sanitizeFolderName(basename(repoRoot))
  // If worktree name is already the repo name (main repo case), just use it
  if (repoName === worktreeName) {
    return worktreeName
  }
  return `${repoName}-${worktreeName}`
}

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
 * Get the relative path to the user-editable override compose file
 */
export function getUserOverrideComposeRelativePath(): string {
  return join(PORT_DIR, USER_OVERRIDE_COMPOSE_FILE)
}

/**
 * Get the relative path to the rendered user override compose file
 */
export function getUserOverrideRenderedRelativePath(): string {
  return join(PORT_DIR, USER_OVERRIDE_RENDERED_FILE)
}

/**
 * Build compose file stack in precedence order (last file wins)
 */
export function getComposeFileStack(
  composeFile: string,
  userOverrideFile?: string | null
): string[] {
  const files = [composeFile, getOverrideRelativePath()]

  if (userOverrideFile) {
    files.push(userOverrideFile)
  }

  return files
}

/**
 * Render PORT_* variables in a compose template-like file.
 *
 * Supports both $PORT_VAR and ${PORT_VAR} forms.
 */
export function renderPortVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\$\{(PORT_[A-Z0-9_]+)\}|\$(PORT_[A-Z0-9_]+)/g, (match, braced, bare) => {
    const key = (braced ?? bare) as string
    return variables[key] ?? match
  })
}

function buildUserOverrideVariables(context: UserOverrideRenderContext): Record<string, string> {
  return {
    PORT_ROOT_PATH: context.repoRoot,
    PORT_WORKTREE_PATH: context.worktreePath,
    PORT_BRANCH: context.branch,
    PORT_DOMAIN: context.domain,
    PORT_PROJECT_NAME: context.projectName,
    PORT_COMPOSE_FILE: context.composeFile,
  }
}

/**
 * Render .port/override-compose.yml into .port/override.user.yml when present.
 *
 * @returns Relative path to rendered file, or null when source file is missing.
 */
export async function renderUserOverrideFile(
  context: UserOverrideRenderContext
): Promise<string | null> {
  const sourceRelativePath = getUserOverrideComposeRelativePath()
  const sourcePath = join(context.worktreePath, sourceRelativePath)

  if (!existsSync(sourcePath)) {
    return null
  }

  const renderedRelativePath = getUserOverrideRenderedRelativePath()
  const renderedPath = join(context.worktreePath, renderedRelativePath)
  const source = await readFile(sourcePath, 'utf-8')
  const rendered = renderPortVariables(source, buildUserOverrideVariables(context))

  await mkdir(join(context.worktreePath, PORT_DIR), { recursive: true })
  await writeFile(renderedPath, rendered)

  return renderedRelativePath
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
 * Parsed published -> target port mapping for a compose service
 */
interface ServicePortMapping {
  published: number
  target: number
}

const MAX_CONTAINER_NAME_LENGTH = 128

function stableHash(input: string): string {
  let hash = 5381

  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }

  return (hash >>> 0).toString(36)
}

/**
 * Normalize a container name to docker's supported character set.
 *
 * Docker names must match [a-z0-9][a-z0-9_.-]*.
 */
function normalizeContainerName(identity: string, serviceName: string): string {
  const raw = `${identity}-${serviceName}`
  let normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')

  if (!normalized) {
    normalized = 'port'
  }

  if (normalized.length <= MAX_CONTAINER_NAME_LENGTH) {
    return normalized
  }

  const suffix = stableHash(raw)
  const maxPrefixLength = MAX_CONTAINER_NAME_LENGTH - suffix.length - 1
  const prefix = normalized.slice(0, Math.max(1, maxPrefixLength)).replace(/[^a-z0-9]+$/, '')

  return `${prefix}-${suffix}`
}

/**
 * Parse a compose port value that may be a string or number
 */
function parsePort(value: string | number | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }

  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  return null
}

/**
 * Get all published -> target port mappings from a parsed compose service
 */
function getServicePortMappings(service: ParsedComposeService): ServicePortMapping[] {
  if (!service.ports || service.ports.length === 0) {
    return []
  }

  const mappings: ServicePortMapping[] = []

  for (const port of service.ports) {
    const published = parsePort(port.published)
    const target = parsePort(port.target)

    if (published === null || target === null) {
      continue
    }

    mappings.push({ published, target })
  }

  return mappings
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
  return getServicePortMappings(service).map(port => port.published)
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

function generateTraefikHttpLabels(
  worktreeName: string,
  serviceName: string,
  publishedPort: number,
  targetPort: number,
  domain: string
): string[] {
  const routerName = `${worktreeName}-${serviceName}-${publishedPort}`
  const hostname = `${worktreeName}.${domain}`

  return [
    `traefik.http.routers.${routerName}.rule=Host(\`${hostname}\`)`,
    `traefik.http.routers.${routerName}.entrypoints=port${publishedPort}`,
    `traefik.http.routers.${routerName}.service=${routerName}`,
    `traefik.http.services.${routerName}.loadbalancer.server.port=${targetPort}`,
  ]
}

function generateTraefikTcpLabels(
  worktreeName: string,
  serviceName: string,
  publishedPort: number,
  targetPort: number,
  domain: string
): string[] {
  const routerName = `${worktreeName}-${serviceName}-${publishedPort}`
  const hostname = `${worktreeName}.${domain}`

  return [
    `traefik.tcp.routers.${routerName}.rule=HostSNI(\`${hostname}\`)`,
    `traefik.tcp.routers.${routerName}.entrypoints=port${publishedPort}`,
    `traefik.tcp.routers.${routerName}.service=${routerName}`,
    `traefik.tcp.routers.${routerName}.tls=true`,
    `traefik.tcp.services.${routerName}.loadbalancer.server.port=${targetPort}`,
  ]
}

/**
 * Generate Traefik labels for a service port.
 *
 * We emit both HTTP and TCP routers so hostname-based routing works for
 * HTTP traffic and TCP protocols (for example Postgres) on the same
 * `.port` domain conventions.
 */
function generateTraefikLabels(
  worktreeName: string,
  serviceName: string,
  publishedPort: number,
  targetPort: number,
  domain: string
): string[] {
  return [
    ...generateTraefikHttpLabels(worktreeName, serviceName, publishedPort, targetPort, domain),
    ...generateTraefikTcpLabels(worktreeName, serviceName, publishedPort, targetPort, domain),
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
  domain: string = 'port',
  projectName: string = worktreeName
): string {
  const services: Record<string, unknown> = {}

  for (const [serviceName, service] of Object.entries(parsedCompose.services)) {
    const ports = getServicePortMappings(service)

    const serviceOverride: Record<string, unknown> = {}

    if (service.container_name) {
      serviceOverride.container_name = normalizeContainerName(projectName, serviceName)
    }

    // Only add Traefik config for services with ports
    if (ports.length > 0) {
      const labels = ['traefik.enable=true']

      // Add labels for each port
      for (const port of ports) {
        labels.push(
          ...generateTraefikLabels(worktreeName, serviceName, port.published, port.target, domain)
        )
      }

      serviceOverride.ports = [] // Will be prefixed with !override in output
      // Keep the default project network for inter-service DNS resolution
      // (e.g. app → postgres) and add traefik-network for external routing.
      // Without "default", all services share only traefik-network, causing
      // DNS alias collisions when multiple projects use the same service names.
      serviceOverride.networks = ['default', TRAEFIK_NETWORK]
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
  domain: string = 'port',
  projectName: string = worktreeName
): Promise<void> {
  const content = generateOverrideContent(parsedCompose, worktreeName, domain, projectName)
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
 * Run a docker compose command with the appropriate -p and -f flags
 *
 * This is the core function for running docker compose commands. It:
 * - Automatically includes the project name (-p flag)
 * - Automatically includes the compose file and override file (-f flags)
 * - Streams output to the terminal in real-time
 *
 * @param cwd - Working directory
 * @param composeFile - Path to docker-compose file
 * @param projectName - Project name for docker-compose (used for container naming)
 * @param args - Arguments to pass to docker compose (e.g., ['up', '-d'], ['down'], ['logs', '-f'])
 * @returns Object with exitCode
 */
export async function runCompose(
  cwd: string,
  composeFile: string,
  projectName: string,
  args: string[],
  runtimeContext?: ComposeRuntimeContext
): Promise<{ exitCode: number }> {
  const cmd = await getComposeCommand()
  const renderedUserOverride = runtimeContext
    ? await renderUserOverrideFile({
        repoRoot: runtimeContext.repoRoot,
        worktreePath: cwd,
        branch: runtimeContext.branch,
        domain: runtimeContext.domain,
        composeFile,
        projectName,
      })
    : null
  const composeFiles = getComposeFileStack(composeFile, renderedUserOverride)

  // Build the full command with -p and -f flags
  const fullArgs = ['-p', projectName]

  for (const file of composeFiles) {
    fullArgs.push('-f', file)
  }

  fullArgs.push(...args)
  const fullCommand = `${cmd} ${fullArgs.join(' ')}`

  return execWithStdio(fullCommand, { cwd })
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
  projectName: string,
  runtimeContext?: ComposeRuntimeContext
): Promise<Array<{ name: string; status: string; running: boolean }>> {
  const cmd = await getComposeCommand()
  const renderedUserOverride = runtimeContext
    ? await renderUserOverrideFile({
        repoRoot: runtimeContext.repoRoot,
        worktreePath: cwd,
        branch: runtimeContext.branch,
        domain: runtimeContext.domain,
        composeFile,
        projectName,
      })
    : null
  const composeFiles = getComposeFileStack(composeFile, renderedUserOverride)
  const composeFileFlags = composeFiles.map(file => `-f ${file}`).join(' ')

  try {
    const { stdout } = await execAsync(
      `${cmd} -p ${projectName} ${composeFileFlags} ps --format json`,
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
 * Restart Traefik container (needed after config changes).
 *
 * Uses `up -d` instead of `restart` so the container is recreated when the
 * compose file changes (e.g. new port mappings or volume mounts).  A plain
 * `restart` only stops/starts the existing container, leaving stale port
 * bindings in place.
 */
export async function restartTraefik(): Promise<void> {
  const cmd = await getComposeCommand()

  try {
    await execAsync(`${cmd} up -d`, {
      cwd: TRAEFIK_DIR,
      timeout: 60000,
    })
  } catch (error) {
    throw new ComposeError(`Failed to restart Traefik: ${error}`)
  }
}

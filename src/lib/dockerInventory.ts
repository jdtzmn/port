import { execFileAsync } from './exec.ts'

const PROJECT_LABEL = 'com.docker.compose.project'
const SERVICE_LABEL = 'com.docker.compose.service'
const ONE_OFF_LABEL = 'com.docker.compose.oneoff'
const FORMAT = `{"project":{{json (.Label "${PROJECT_LABEL}")}},"service":{{json (.Label "${SERVICE_LABEL}")}}}`
const ACTIVE_FORMAT = `{"project":{{json (.Label "${PROJECT_LABEL}")}},"service":{{json (.Label "${SERVICE_LABEL}")}},"state":{{json .State}}}`
const ACTIVE_STATES = new Set(['running', 'paused', 'restarting'])

interface DockerInventoryEntry {
  project: string
  service: string
  state?: string
}

function isDockerInventoryEntry(value: unknown): value is DockerInventoryEntry {
  if (typeof value !== 'object' || value === null) return false

  const entry = value as Record<string, unknown>
  return (
    typeof entry.project === 'string' &&
    entry.project !== '' &&
    typeof entry.service === 'string' &&
    entry.service !== '' &&
    (entry.state === undefined || typeof entry.state === 'string')
  )
}

/**
 * List Compose services once and group them by Compose project.
 *
 * Active mode includes paused and restarting containers while excluding stopped containers.
 * Returns null when Docker cannot be queried so callers can use a narrower fallback.
 */
async function getComposeServiceInventory(
  mode: 'running' | 'active'
): Promise<Map<string, Set<string>> | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'ps',
        '--filter',
        `label=${PROJECT_LABEL}`,
        '--filter',
        `label=${SERVICE_LABEL}`,
        '--filter',
        `label=${ONE_OFF_LABEL}=False`,
        ...(mode === 'active' ? ['--all'] : []),
        ...(mode === 'running' ? ['--filter', 'status=running'] : []),
        '--format',
        mode === 'active' ? ACTIVE_FORMAT : FORMAT,
      ],
      { encoding: 'utf8', timeout: 10_000 }
    )
    const inventory = new Map<string, Set<string>>()

    for (const line of stdout.trim().split('\n')) {
      if (!line) continue

      const entry: unknown = JSON.parse(line)
      if (!isDockerInventoryEntry(entry)) return null
      if (mode === 'active' && !ACTIVE_STATES.has(entry.state ?? '')) continue

      const services = inventory.get(entry.project) ?? new Set<string>()
      services.add(entry.service)
      inventory.set(entry.project, services)
    }

    return inventory
  } catch {
    return null
  }
}

/** List running Compose services once and group them by project. */
export function getRunningComposeServiceInventory(): Promise<Map<string, Set<string>> | null> {
  return getComposeServiceInventory('running')
}

/** List Compose services in all active Docker states once and group them by project. */
export function getActiveComposeServiceInventory(): Promise<Map<string, Set<string>> | null> {
  return getComposeServiceInventory('active')
}

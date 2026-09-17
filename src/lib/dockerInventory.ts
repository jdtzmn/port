import { execFileAsync } from './exec.ts'

const PROJECT_LABEL = 'com.docker.compose.project'
const SERVICE_LABEL = 'com.docker.compose.service'
const FORMAT = `{"project":{{json (.Label "${PROJECT_LABEL}")}},"service":{{json (.Label "${SERVICE_LABEL}")}}}`

interface DockerInventoryEntry {
  project: string
  service: string
}

function isDockerInventoryEntry(value: unknown): value is DockerInventoryEntry {
  if (typeof value !== 'object' || value === null) return false

  const entry = value as Record<string, unknown>
  return (
    typeof entry.project === 'string' &&
    entry.project !== '' &&
    typeof entry.service === 'string' &&
    entry.service !== ''
  )
}

/**
 * List running Compose services once and group them by Compose project.
 *
 * Returns null when Docker cannot be queried so callers can use a narrower
 * fallback rather than reporting every service as stopped.
 */
export async function getRunningComposeServiceInventory(): Promise<Map<
  string,
  Set<string>
> | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['ps', '--filter', `label=${PROJECT_LABEL}`, '--format', FORMAT],
      { encoding: 'utf8', timeout: 10_000 }
    )
    const inventory = new Map<string, Set<string>>()

    for (const line of stdout.trim().split('\n')) {
      if (!line) continue

      try {
        const entry: unknown = JSON.parse(line)
        if (!isDockerInventoryEntry(entry)) continue

        const services = inventory.get(entry.project) ?? new Set<string>()
        services.add(entry.service)
        inventory.set(entry.project, services)
      } catch {
        // Ignore malformed containers rather than failing the full inventory.
      }
    }

    return inventory
  } catch {
    return null
  }
}

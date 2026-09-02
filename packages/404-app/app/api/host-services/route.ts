import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

export const dynamic = 'force-dynamic'

interface HostService {
  repo: string
  branch: string
  logicalPort: number
  actualPort: number
  pid: number
  configFile: string
  command?: string
}

interface Registry {
  projects: any[]
  hostServices?: HostService[]
}

interface ServiceEntry {
  name: string
  port: number
  url: string
}

interface WorktreeEntry {
  name: string
  services: ServiceEntry[]
}

/**
 * Get host services from the port registry
 * Returns worktree entries with their services grouped by worktree name
 * Note: This doesn't filter by process status since PIDs are not accessible
 * from within the Docker container. Stale services are cleaned up by
 * cleanupStaleHostServices() when port commands are run.
 */
export async function GET() {
  try {
    const registryPath = process.env.PORT_REGISTRY_PATH || '/mnt/port-data/registry.json'

    if (!existsSync(registryPath)) {
      return NextResponse.json([])
    }

    const content = await readFile(registryPath, 'utf8')
    const registry = JSON.parse(content) as Registry

    if (!registry.hostServices || registry.hostServices.length === 0) {
      return NextResponse.json([])
    }

    const worktreeMap = new Map<string, ServiceEntry[]>()
    const domain = 'port' // Default domain - could be enhanced to read from config

    for (const service of registry.hostServices) {
      const worktreeName = service.branch
      const serviceName = service.command?.trim() || `port ${service.logicalPort}`
      const port = service.logicalPort
      const url = `http://${service.branch}.${domain}:${port}`

      if (!worktreeMap.has(worktreeName)) {
        worktreeMap.set(worktreeName, [])
      }

      const existing = worktreeMap.get(worktreeName)!
      const alreadyAdded = existing.some(s => s.name === serviceName && s.port === port)
      if (!alreadyAdded) {
        existing.push({ name: serviceName, port, url })
      }
    }

    const result: WorktreeEntry[] = []
    for (const [name, services] of worktreeMap) {
      services.sort((a, b) => a.port - b.port)
      result.push({ name, services })
    }
    result.sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to read host services:', error)
    return NextResponse.json([])
  }
}

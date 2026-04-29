import http from 'http'

export interface ServiceEntry {
  name: string
  port: number
  url: string
}

export interface WorktreeEntry {
  name: string
  services: ServiceEntry[]
}

interface DockerContainer {
  Labels: Record<string, string>
}

/**
 * Parse Traefik HTTP router labels from a container's label map.
 *
 * Each HTTP router label looks like:
 *   traefik.http.routers.{worktree}-{service}-{port}.rule=Host(`{hostname}`)
 *
 * We parse the router name to extract worktree, service, and port, then
 * build the port-specific URL from the hostname in the Host() rule.
 *
 * Returns a flat list of { worktreeName, serviceName, port, url } entries,
 * deduplicated (HTTP and TCP routers share the same router name).
 */
function parseServicesFromLabels(
  labels: Record<string, string>
): { worktreeName: string; serviceName: string; port: number; url: string }[] {
  const seen = new Set<string>()
  const results: { worktreeName: string; serviceName: string; port: number; url: string }[] = []

  for (const [key, value] of Object.entries(labels)) {
    // Match: traefik.http.routers.{routerName}.rule
    const routerMatch = /^traefik\.http\.routers\.(.+)\.rule$/.exec(key)
    if (!routerMatch || !routerMatch[1]) continue

    const routerName = routerMatch[1]

    // Extract hostname from Host(`...`) rule
    const hostMatch = /Host\(`([^`]+)`\)/.exec(value)
    if (!hostMatch || !hostMatch[1]) continue
    const hostname = hostMatch[1]

    // Router name format: {worktreeName}-{serviceName}-{publishedPort}
    // Port is always the last dash-separated segment (numeric)
    const lastDash = routerName.lastIndexOf('-')
    if (lastDash === -1) continue
    const portStr = routerName.slice(lastDash + 1)
    const port = parseInt(portStr, 10)
    if (isNaN(port)) continue

    const worktreeAndService = routerName.slice(0, lastDash)

    // Worktree name is the first dash-separated segment (matches hostname prefix)
    // Service name is everything between worktree and port
    const worktreeName = hostname.split('.')[0] ?? worktreeAndService
    const secondDash = worktreeAndService.indexOf('-')
    const serviceName =
      secondDash !== -1 ? worktreeAndService.slice(secondDash + 1) : worktreeAndService

    const dedupeKey = `${worktreeName}|${serviceName}|${port}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    results.push({
      worktreeName,
      serviceName,
      port,
      url: `http://${hostname}:${port}`,
    })
  }

  return results
}

/**
 * Query Docker Unix socket for running containers with traefik.enable=true.
 * Returns worktree entries with their services grouped by worktree name.
 * Returns empty array if Docker socket is unavailable or on any error.
 */
export async function getRunningWorktrees(): Promise<WorktreeEntry[]> {
  try {
    const containers = await dockerGet<DockerContainer[]>(
      '/containers/json?filters=' +
        encodeURIComponent(JSON.stringify({ label: ['traefik.enable=true'] }))
    )

    const worktreeMap = new Map<string, ServiceEntry[]>()

    for (const container of containers) {
      const services = parseServicesFromLabels(container.Labels)
      for (const { worktreeName, serviceName, port, url } of services) {
        if (!worktreeMap.has(worktreeName)) {
          worktreeMap.set(worktreeName, [])
        }
        const existing = worktreeMap.get(worktreeName)!
        const alreadyAdded = existing.some(s => s.name === serviceName && s.port === port)
        if (!alreadyAdded) {
          existing.push({ name: serviceName, port, url })
        }
      }
    }

    const result: WorktreeEntry[] = []
    for (const [name, services] of worktreeMap) {
      services.sort((a, b) => a.port - b.port)
      result.push({ name, services })
    }
    result.sort((a, b) => a.name.localeCompare(b.name))

    return result
  } catch {
    return []
  }
}

function dockerGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        socketPath: '/var/run/docker.sock',
        path,
      },
      res => {
        let data = ''
        res.on('data', (chunk: string) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T)
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

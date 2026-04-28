import http from 'http'

export interface WorktreeLink {
  name: string
  url: string
}

/**
 * Parse Host(`foo.bar`) rules from a Traefik label value string.
 * Returns the full hostname (e.g. "feature-1.port").
 */
function parseHostsFromLabels(labels: Record<string, string>): string[] {
  const hosts: string[] = []
  for (const value of Object.values(labels)) {
    const re = /Host\(`([^`]+)`\)/g
    let match: RegExpExecArray | null
    while ((match = re.exec(value)) !== null) {
      if (match[1]) hosts.push(match[1])
    }
  }
  return hosts
}

/**
 * Query Docker Unix socket for running containers with traefik.enable=true.
 * Returns worktree links derived from Host() rules in Traefik labels.
 * Returns empty array if Docker socket is unavailable or on any error.
 */
export async function getRunningWorktrees(): Promise<WorktreeLink[]> {
  try {
    const containers = await dockerGet<DockerContainer[]>(
      '/containers/json?filters=' +
        encodeURIComponent(JSON.stringify({ label: ['traefik.enable=true'] }))
    )

    const hosts = containers.flatMap(c => parseHostsFromLabels(c.Labels))
    const seen = new Set<string>()
    const unique = hosts.filter(h => {
      if (seen.has(h)) return false
      seen.add(h)
      return true
    })

    return unique.map(host => ({
      name: host.split('.')[0] ?? host,
      url: `http://${host}`,
    }))
  } catch {
    return []
  }
}

interface DockerContainer {
  Labels: Record<string, string>
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
        res.on('data', chunk => (data += chunk))
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

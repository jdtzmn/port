import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, getComposeFile, ensurePortRuntimeDir } from '../lib/config.ts'
import { parseComposeFile, getServicePorts, composePs } from '../lib/compose.ts'
import { buildProjectName as getProjectName } from '../lib/projectName.ts'
import { formatHostname, formatHostnameLabel } from '../lib/hostname.ts'
import { findRemoteRuntimePaths } from '../lib/remote/coordinator/paths.ts'
import { readRemoteRouteView } from '../lib/remote/coordinator/store.ts'
import {
  describeRemoteRoute,
  remoteHttpRoutes,
  remoteRouteUrl,
} from '../lib/remote/routing/view.ts'
import * as output from '../lib/output.ts'

export interface UrlOptions {
  /** List every discovered remote namespace; works outside a worktree. */
  remote?: boolean
}

async function remoteRouteView() {
  const paths = await findRemoteRuntimePaths()
  return paths ? readRemoteRouteView(paths.root) : undefined
}

function printRemoteRoutes(routes: ReturnType<typeof remoteHttpRoutes>, title: string): void {
  output.header(title)
  for (const route of routes) {
    console.error(
      `  ${output.url(remoteRouteUrl(route))} ${output.dim(describeRemoteRoute(route))}`
    )
  }
}

/** Show service URLs for the current worktree, or all remote routes with --remote. */
export async function urls(serviceName?: string, options: UrlOptions = {}): Promise<void> {
  if (options.remote) {
    try {
      const view = await remoteRouteView()
      const visible = view ? remoteHttpRoutes(view, { serviceName }) : []
      if (visible.length === 0) {
        output.warn('No remote HTTP routes are currently published')
        return
      }
      printRemoteRoutes(visible, 'Remote service URLs:')
      return
    } catch {
      output.warn('Remote route view is unavailable')
      return
    }
  }

  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch {
    output.error('Not in a git repository')
    process.exit(1)
  }

  const { repoRoot, worktreePath, name } = worktreeInfo

  await ensurePortRuntimeDir(repoRoot)

  const config = await loadConfigOrDefault(repoRoot)
  if (config.domain === 'port') {
    try {
      const view = await remoteRouteView()
      const visible = view
        ? remoteHttpRoutes(view, {
            namespace: formatHostname(name, config.domain),
            serviceName,
          })
        : []
      if (visible.length > 0) {
        printRemoteRoutes(visible, `Remote service URLs for ${output.branch(name)}:`)
        return
      }
    } catch {
      // Remote discovery is optional for the ordinary current-worktree command.
    }
  }

  const composeFile = getComposeFile(config)
  const projectName = getProjectName(repoRoot, name)

  let parsedCompose
  const psPromise = composePs(worktreePath, composeFile, projectName, {
    repoRoot,
    branch: name,
    domain: config.domain,
  }).catch(() => [])

  let psResult: Array<{ name: string; status: string; running: boolean }>
  try {
    const [composeResult, statusResult] = await Promise.all([
      parseComposeFile(worktreePath, composeFile),
      psPromise,
    ])
    parsedCompose = composeResult
    psResult = statusResult
  } catch (error) {
    output.error(`Failed to parse docker-compose file: ${error}`)
    process.exit(1)
  }

  // Query Docker for running container status
  const runningServices = new Map(psResult.map(s => [s.name, s.running]))

  const services = Object.entries(parsedCompose.services)
    .map(([service, definition]) => {
      const ports = getServicePorts(definition)
      const running = Array.from(runningServices.entries()).some(
        ([containerName, isRunning]) => containerName.includes(service) && isRunning
      )
      const urls =
        ports.length > 0 ? [`http://${service}.${formatHostnameLabel(name)}.${config.domain}`] : []
      urls.push(...ports.map(port => `http://${formatHostname(name, config.domain)}:${port}`))

      return {
        name: service,
        urls,
        running,
      }
    })
    .filter(service => service.urls.length > 0)

  if (serviceName) {
    const selectedService = services.find(service => service.name === serviceName)

    if (!selectedService) {
      output.error(`Service "${serviceName}" not found in current worktree`)
      process.exit(1)
    }

    output.header(`Service URLs for ${output.branch(name)}:`)
    output.serviceUrls([selectedService])
    return
  }

  if (services.length === 0) {
    output.warn('No services with published ports found in current worktree')
    return
  }

  output.header(`Service URLs for ${output.branch(name)}:`)
  output.serviceUrls(services)
}

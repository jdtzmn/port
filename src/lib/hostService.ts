import { writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { stringify as yamlStringify } from 'yaml'
import { createServer, type Server } from 'net'
import { TRAEFIK_DYNAMIC_DIR, ensureTraefikDynamicDir } from './traefik.ts'
import {
  registerHostService as registryRegisterHostService,
  unregisterHostService as registryUnregisterHostService,
  getAllHostServices,
} from './registry.ts'
import type { HostService } from '../types.ts'

const SIGTERM_GRACE_PERIOD_MS = 2000
const PROCESS_POLL_INTERVAL_MS = 50

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true
    }
    await sleep(PROCESS_POLL_INTERVAL_MS)
  }

  return !isProcessRunning(pid)
}

export type StopSignal = 'already_stopped' | 'sigterm' | 'sigkill'

interface StopHostServiceOptions {
  gracePeriodMs?: number
}

/**
 * Find an available port in the ephemeral range (49152-65535)
 * Uses Node's net module to find a free port
 *
 * @returns Available port number
 */
export async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer()

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('Failed to get port from server address')))
      }
    })

    server.on('error', err => {
      reject(err)
    })
  })
}

/**
 * Write Traefik dynamic config file for a host service
 *
 * @param branch - Sanitized branch/worktree name
 * @param logicalPort - Port users access (e.g., 3000)
 * @param actualPort - Actual port the process listens on
 * @param domain - Domain suffix (e.g., 'port')
 * @returns Path to the config file
 */
export async function writeHostServiceConfig(
  branch: string,
  logicalPort: number,
  actualPort: number,
  domain: string
): Promise<string> {
  await ensureTraefikDynamicDir()

  const routerName = `${branch}-${logicalPort}`
  const hostname = `${branch}.${domain}`

  const config = {
    http: {
      routers: {
        [routerName]: {
          rule: `Host(\`${hostname}\`)`,
          entryPoints: [`port${logicalPort}`],
          service: routerName,
        },
      },
      services: {
        [routerName]: {
          loadBalancer: {
            servers: [{ url: `http://host.docker.internal:${actualPort}` }],
          },
        },
      },
    },
  }

  const configFile = join(TRAEFIK_DYNAMIC_DIR, `${branch}-${logicalPort}.yml`)
  await writeFile(configFile, yamlStringify(config))

  return configFile
}

/**
 * Remove Traefik dynamic config file
 *
 * @param configFile - Path to the config file
 */
export async function removeHostServiceConfig(configFile: string): Promise<void> {
  if (existsSync(configFile)) {
    await unlink(configFile)
  }
}

/**
 * Register a host service in the global registry
 *
 * @param service - The host service to register
 */
export async function registerHostService(service: HostService): Promise<void> {
  await registryRegisterHostService(service)
}

/**
 * Unregister a host service from the global registry
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 * @param logicalPort - The logical port
 */
export async function unregisterHostService(
  repo: string,
  branch: string,
  logicalPort: number
): Promise<void> {
  await registryUnregisterHostService(repo, branch, logicalPort)
}

/**
 * Check if a process is still running by PID
 *
 * @param pid - Process ID to check
 * @returns true if the process is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process but checks if it exists
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Clean up stale host services (dead PIDs)
 * Should be called opportunistically on any port command
 */
export async function cleanupStaleHostServices(): Promise<void> {
  const hostServices = await getAllHostServices()

  for (const service of hostServices) {
    if (!isProcessRunning(service.pid)) {
      // Process is dead, clean up
      await removeHostServiceConfig(service.configFile)
      await unregisterHostService(service.repo, service.branch, service.logicalPort)
    }
  }
}

/**
 * Stop a host service by killing its process and cleaning up
 *
 * @param service - The host service to stop
 */
export async function stopHostService(
  service: HostService,
  options: StopHostServiceOptions = {}
): Promise<StopSignal> {
  const gracePeriodMs = options.gracePeriodMs ?? SIGTERM_GRACE_PERIOD_MS
  let stopSignal: StopSignal = 'already_stopped'

  if (isProcessRunning(service.pid)) {
    try {
      process.kill(service.pid, 'SIGTERM')
      stopSignal = 'sigterm'
    } catch {
      // Process might have already exited.
    }

    if (isProcessRunning(service.pid)) {
      const exitedAfterSigterm = await waitForProcessExit(service.pid, gracePeriodMs)

      if (!exitedAfterSigterm) {
        try {
          process.kill(service.pid, 'SIGKILL')
          stopSignal = 'sigkill'
        } catch {
          // Process might have already exited.
        }
      }
    }

    if (isProcessRunning(service.pid)) {
      throw new Error(`Process ${service.pid} did not stop`)
    }
  }

  // Clean up config and registry
  await removeHostServiceConfig(service.configFile)
  await unregisterHostService(service.repo, service.branch, service.logicalPort)

  return stopSignal
}

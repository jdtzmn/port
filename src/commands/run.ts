import { spawn, type ChildProcess } from 'child_process'
import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfig, configExists } from '../lib/config.ts'
import { getHostService } from '../lib/registry.ts'
import { ensureTraefikPorts, traefikFilesExist, initTraefikFiles } from '../lib/traefik.ts'
import { startTraefik, isTraefikRunning, restartTraefik } from '../lib/compose.ts'
import {
  findAvailablePort,
  writeHostServiceConfig,
  removeHostServiceConfig,
  registerHostService,
  unregisterHostService,
  cleanupStaleHostServices,
  stopHostService,
} from '../lib/hostService.ts'
import type { HostService } from '../types.ts'
import * as output from '../lib/output.ts'

/**
 * Run a host process with Traefik routing
 *
 * @param logicalPort - The port users will access
 * @param command - The command and arguments to run
 */
export async function run(logicalPort: number, command: string[]): Promise<void> {
  // Validate inputs
  if (isNaN(logicalPort) || logicalPort <= 0 || logicalPort > 65535) {
    output.error('Invalid port number. Must be between 1 and 65535.')
    process.exit(1)
  }

  if (command.length === 0) {
    output.error('No command specified. Usage: port run <port> -- <command...>')
    process.exit(1)
  }

  // Detect worktree info
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch (error) {
    output.error(`${error}`)
    process.exit(1)
  }

  const { repoRoot, name: branch } = worktreeInfo

  // Check if port is initialized
  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  // Load config to get domain
  const config = await loadConfig(repoRoot)
  const domain = config.domain

  // Clean up stale host services
  await cleanupStaleHostServices()

  // Check if a host service is already running for this branch+port
  const existingService = await getHostService(repoRoot, branch, logicalPort)
  if (existingService) {
    const { replace } = await inquirer.prompt<{ replace: boolean }>([
      {
        type: 'confirm',
        name: 'replace',
        message: `Service already running for ${branch}:${logicalPort}. Replace?`,
        default: false,
      },
    ])

    if (!replace) {
      output.info('Aborted.')
      process.exit(0)
    }

    // Stop the existing service
    output.info('Stopping existing service...')
    await stopHostService(existingService)
    output.success('Existing service stopped')
  }

  // Find an available ephemeral port
  const actualPort = await findAvailablePort()
  output.info(`Allocated port ${actualPort} for internal use`)

  // Ensure Traefik has the entrypoint for the logical port
  if (!traefikFilesExist()) {
    output.info('Initializing Traefik configuration...')
    await initTraefikFiles([logicalPort])
    output.success('Traefik configuration created')
  }

  const configUpdated = await ensureTraefikPorts([logicalPort])
  if (configUpdated) {
    output.info('Updated Traefik configuration with new port')
  }

  // Start or restart Traefik if needed
  const traefikRunning = await isTraefikRunning()
  if (!traefikRunning) {
    output.info('Starting Traefik...')
    try {
      await startTraefik()
      output.success('Traefik started')
    } catch (error) {
      output.error(`Failed to start Traefik: ${error}`)
      process.exit(1)
    }
  } else if (configUpdated) {
    output.info('Restarting Traefik with new configuration...')
    try {
      await restartTraefik()
      output.success('Traefik restarted')
    } catch (error) {
      output.warn(`Failed to restart Traefik: ${error}`)
    }
  }

  // Write Traefik dynamic config
  const configFile = await writeHostServiceConfig(branch, logicalPort, actualPort, domain)
  output.dim(`Created Traefik config: ${configFile}`)

  // Register with placeholder PID (will be updated)
  const service: HostService = {
    repo: repoRoot,
    branch,
    logicalPort,
    actualPort,
    pid: -1,
    configFile,
  }
  await registerHostService(service)

  // Cleanup function
  const cleanup = async () => {
    await removeHostServiceConfig(configFile)
    await unregisterHostService(repoRoot, branch, logicalPort)
  }

  // Set up signal handlers
  let cleanupDone = false
  const handleSignal = async (signal: string, exitCode: number) => {
    if (cleanupDone) return
    cleanupDone = true
    output.newline()
    output.info(`Received ${signal}, cleaning up...`)
    await cleanup()
    process.exit(exitCode)
  }

  process.on('SIGINT', () => handleSignal('SIGINT', 130))
  process.on('SIGTERM', () => handleSignal('SIGTERM', 143))
  process.on('SIGHUP', () => handleSignal('SIGHUP', 129))

  // Spawn the child process
  const [cmd, ...args] = command

  if (!cmd) {
    output.error('No command specified.')
    await cleanup()
    process.exit(1)
  }

  output.newline()
  output.success(`Service running at ${output.url(`http://${branch}.${domain}:${logicalPort}`)}`)
  output.info(`Running: ${command.join(' ')}`)
  output.newline()

  const child: ChildProcess = spawn(cmd, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: actualPort.toString(),
    },
  })

  // Update registry with actual PID
  if (child.pid) {
    service.pid = child.pid
    await registerHostService(service)
  }

  // Wait for child process to exit
  child.on('exit', async (code: number | null, signal: NodeJS.Signals | null) => {
    if (cleanupDone) return
    cleanupDone = true

    output.newline()
    if (signal) {
      output.info(`Process killed with signal ${signal}`)
    } else if (code !== 0) {
      output.warn(`Process exited with code ${code}`)
    }

    await cleanup()
    process.exit(code ?? 1)
  })

  child.on('error', async (err: Error) => {
    if (cleanupDone) return
    cleanupDone = true

    output.error(`Failed to start process: ${err.message}`)
    await cleanup()
    process.exit(1)
  })
}

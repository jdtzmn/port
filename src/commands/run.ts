import { spawn, type ChildProcess } from 'child_process'
import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, ensurePortRuntimeDir } from '../lib/config.ts'
import { getHostService } from '../lib/registry.ts'
import { prepareSharedStack } from '../lib/shared-stack.ts'
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

  await ensurePortRuntimeDir(repoRoot)

  // Load config to get domain (defaults when config file is absent)
  const config = await loadConfigOrDefault(repoRoot)
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

  const sharedStackResult = await prepareSharedStack([logicalPort])
  if (sharedStackResult.started) {
    output.success('port started')
  } else if (sharedStackResult.restarted) {
    output.success('port restarted')
  } else if (sharedStackResult.updated) {
    output.info('Updated port configuration')
  }

  // Write Traefik dynamic config
  const configFile = await writeHostServiceConfig(branch, logicalPort, actualPort, domain)
  output.dim(`Created port config: ${configFile}`)

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

import { spawn, type ChildProcess } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdtemp, readFile, rm, writeFile, open } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import inquirer from 'inquirer'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, ensurePortRuntimeDir } from '../lib/config.ts'
import { getHostService, getAllProjects, getAllHostServices } from '../lib/registry.ts'
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
  isProcessRunning,
} from '../lib/hostService.ts'
import {
  findHostnameLabelCollisions,
  formatHostname,
  formatHostnameLabel,
} from '../lib/hostname.ts'
import type { HostService } from '../types.ts'
import * as output from '../lib/output.ts'
import { hookExists, runPreRunHook } from '../lib/hooks.ts'

function parseEnvOverrides(content: string): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {}

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    overrides[key] = trimmed.slice(equalsIndex + 1)
  }

  return overrides
}

/**
 * Run a host process with Traefik routing
 *
 * @param logicalPort - The port users will access
 * @param command - The command and arguments to run
 * @param options - Command options
 */
export async function run(
  logicalPort: number,
  command: string[],
  options: { detached?: boolean } = {}
): Promise<void> {
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

  const [projects, hostServices] = await Promise.all([getAllProjects(), getAllHostServices()])
  const liveHostServices = hostServices.filter(service => isProcessRunning(service.pid))
  const collisions = findHostnameLabelCollisions(repoRoot, branch, [
    ...projects,
    ...liveHostServices,
  ])
  if (collisions.length > 0) {
    output.warn(
      `Hostname label "${formatHostnameLabel(branch)}" already exists for another active service. URLs may collide.`
    )
  }

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
    output.info('Updated Traefik configuration')
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

  let envOverrides: NodeJS.ProcessEnv = {}
  if (await hookExists(repoRoot, 'pre-run')) {
    const envDir = await mkdtemp(join(tmpdir(), 'port-pre-run-'))
    const envFile = join(envDir, 'env')

    try {
      await writeFile(envFile, '')
      output.info('Running pre-run hook...')
      const result = await runPreRunHook({
        repoRoot,
        worktreePath: worktreeInfo.worktreePath,
        branch,
        domain,
        logicalPort,
        actualPort,
        envFile,
      })

      if (!result.success) {
        output.error(`Pre-run hook failed (exit code ${result.exitCode})`)
        output.dim('See .port/logs/latest.log for details')
        await cleanup()
        process.exit(result.exitCode)
      }

      envOverrides = parseEnvOverrides(await readFile(envFile, 'utf8'))
      output.success('Pre-run hook completed')
    } finally {
      await rm(envDir, { recursive: true, force: true })
    }
  }

  // Set up signal handlers (only in foreground mode)
  let cleanupDone = false
  const handleSignal = async (signal: string, exitCode: number) => {
    if (cleanupDone) return
    cleanupDone = true
    output.newline()
    output.info(`Received ${signal}, cleaning up...`)
    await cleanup()
    process.exit(exitCode)
  }

  if (!options.detached) {
    process.on('SIGINT', () => handleSignal('SIGINT', 130))
    process.on('SIGTERM', () => handleSignal('SIGTERM', 143))
    process.on('SIGHUP', () => handleSignal('SIGHUP', 129))
  }

  // Spawn the child process
  const [cmd, ...args] = command

  if (!cmd) {
    output.error('No command specified.')
    await cleanup()
    process.exit(1)
  }

  output.newline()
  output.success(
    `Service running at ${output.url(`http://${formatHostname(branch, domain)}:${logicalPort}`)}`
  )
  output.info(`Running: ${command.join(' ')}`)
  output.newline()

  // In detached mode, redirect output to a log file
  let logFile: string | undefined
  if (options.detached) {
    const logDir = join(repoRoot, '.port', 'logs')
    logFile = join(logDir, `${branch}-${logicalPort}.log`)

    // Ensure log directory exists
    await ensurePortRuntimeDir(repoRoot)

    output.dim(`Logging to: ${logFile}`)
  }

  const child: ChildProcess = spawn(cmd, args, {
    stdio: options.detached ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    detached: options.detached,
    env: {
      ...process.env,
      ...envOverrides,
      PORT: actualPort.toString(),
    },
  })

  // In detached mode, redirect stdout/stderr to log file
  if (options.detached && logFile) {
    const logStream = createWriteStream(logFile, { flags: 'a' })
    if (child.stdout) child.stdout.pipe(logStream)
    if (child.stderr) child.stderr.pipe(logStream)
  }

  // Update registry with actual PID
  if (child.pid) {
    service.pid = child.pid
    await registerHostService(service)
  }

  // In detached mode, detach the child process and exit
  if (options.detached) {
    child.unref()
    output.success('Process started in detached mode')
    output.dim(`Use 'port kill ${logicalPort}' to stop the service`)
    if (logFile) {
      output.dim(`Tail logs: tail -f ${logFile}`)
    }
    process.exit(0)
  }

  // Wait for child process to exit (foreground mode)
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

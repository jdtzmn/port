import { spawn, type ChildProcess } from 'child_process'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { execPortAsync, fetchWithTimeout, prepareSample } from './utils'
import { afterEach, describe, test, expect } from 'vitest'

const TIMEOUT = 45000

describe('port run integration', () => {
  // Track spawned processes for cleanup
  const spawnedProcesses: ChildProcess[] = []

  afterEach(async () => {
    // Kill all spawned processes
    const waitForExit = (proc: ChildProcess, timeoutMs = 3000) =>
      new Promise<void>(resolve => {
        let settled = false
        const finish = () => {
          if (!settled) {
            settled = true
            resolve()
          }
        }

        proc.once('exit', finish)
        proc.once('close', finish)
        setTimeout(finish, timeoutMs)
      })

    const exits: Array<Promise<void>> = []

    for (const proc of spawnedProcesses) {
      try {
        proc.kill('SIGTERM')
        exits.push(waitForExit(proc))
      } catch {
        /* ignore */
      }
    }

    await Promise.all(exits)
    spawnedProcesses.length = 0
  })

  test(
    'two worktrees can run services on the same logical port',
    async () => {
      const sample = await prepareSample('simple-server', {
        initWithConfig: true,
      })

      // Create worktrees A and B
      await execPortAsync(['enter', 'run-a'], sample.dir)
      await execPortAsync(['enter', 'run-b'], sample.dir)

      const worktreeADir = join(sample.dir, '.port/trees/run-a')
      const worktreeBDir = join(sample.dir, '.port/trees/run-b')

      // Spawn first service, wait for readiness, then spawn second.
      // This avoids startup races around first-time Traefik/image initialization in CI.
      const procA = spawnPortRun(3000, ['bun', 'index.ts'], worktreeADir)
      spawnedProcesses.push(procA)

      const aURL = 'http://run-a.port:3000'
      const bURL = 'http://run-b.port:3000'

      const responseA = await pollUntilReady(aURL)

      const procB = spawnPortRun(3000, ['bun', 'index.ts'], worktreeBDir)
      spawnedProcesses.push(procB)

      const responseB = await pollUntilReady(bURL)

      // Parse responses
      const dataA = (await responseA.json()) as { actualPort: number; instanceId: string }
      const dataB = (await responseB.json()) as { actualPort: number; instanceId: string }

      // Verify both services are running on different actual ports
      expect(dataA.actualPort).not.toEqual(dataB.actualPort)

      // Verify actual ports are NOT the logical port (proves PORT env var was used)
      expect(dataA.actualPort).not.toEqual(3000)
      expect(dataB.actualPort).not.toEqual(3000)

      // Verify actual ports are valid (allocated by findAvailablePort)
      expect(dataA.actualPort).toBeGreaterThanOrEqual(1024)
      expect(dataB.actualPort).toBeGreaterThanOrEqual(1024)

      // Verify instance IDs are different (proves they're separate processes)
      expect(dataA.instanceId).not.toEqual(dataB.instanceId)

      await sample.cleanup()
    },
    TIMEOUT
  )

  test(
    'detached run keeps serving after the CLI exits and stops with port kill',
    async () => {
      const sample = await prepareSample('simple-server', {
        initWithConfig: true,
      })

      await execPortAsync(['enter', 'run-detached'], sample.dir)
      const worktreeDir = join(sample.dir, '.port/trees/run-detached')
      const url = 'http://run-detached.port:3000'

      try {
        // The CLI returns as soon as the process is detached, instead of
        // blocking until the host process exits.
        const { stdout, stderr } = await execPortAsync(
          ['run', '3000', '-d', '--', 'bun', 'index.ts'],
          worktreeDir
        )
        expect(`${stdout}${stderr}`).toContain('detached mode')

        const response = await pollUntilReady(url)
        const data = (await response.json()) as { actualPort: number }
        expect(data.actualPort).not.toEqual(3000)

        // Detached output is captured in a per-service log file
        const logFile = join(sample.dir, '.port/logs/run-detached-3000.log')
        const logContents = await pollUntil(
          () => readFile(logFile, 'utf8'),
          contents => contents.includes('Server listening on port')
        )
        expect(logContents).toContain(`Server listening on port ${data.actualPort}`)

        // The detached process stays registered as a running host service
        const status = await execPortAsync(['status'], worktreeDir)
        expect(`${status.stdout}${status.stderr}`).toContain(`run-detached:3000`)

        await execPortAsync(['kill', '3000'], worktreeDir)
        await pollUntilUnreachable(url)
      } finally {
        await execPortAsync(['kill', '3000'], worktreeDir).catch(() => {
          /* already stopped */
        })
        await sample.cleanup()
      }
    },
    TIMEOUT
  )
})

/**
 * Spawn `port run <port> -- <command...>` as a background process
 */
function spawnPortRun(port: number, command: string[], cwd: string): ChildProcess {
  const cliScript = resolve(__dirname, '../src/index.ts')
  return spawn('bun', [cliScript, 'run', port.toString(), '--', ...command], {
    cwd,
    stdio: 'pipe', // Don't inherit to avoid cluttering test output
  })
}

/**
 * Poll a URL until it responds with status 200
 */
async function pollUntilReady(url: string, timeoutMs = 30000): Promise<Response> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url)
      if (response.status === 200) {
        return response
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 200))
  }

  throw new Error(`Timeout waiting for ${url} to respond`)
}

/**
 * Poll a URL until it stops responding with status 200
 */
async function pollUntilUnreachable(url: string, timeoutMs = 15000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, 1000)
      if (response.status !== 200) {
        return
      }
    } catch {
      return
    }
    await new Promise(r => setTimeout(r, 200))
  }

  throw new Error(`Timeout waiting for ${url} to stop responding`)
}

/**
 * Poll an async producer until its value satisfies a predicate
 */
async function pollUntil<T>(
  produce: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15000
): Promise<T> {
  const startTime = Date.now()
  let lastError: unknown

  while (Date.now() - startTime < timeoutMs) {
    try {
      const value = await produce()
      if (predicate(value)) {
        return value
      }
    } catch (error) {
      lastError = error
    }
    await new Promise(r => setTimeout(r, 200))
  }

  throw lastError ?? new Error('Timeout waiting for condition')
}

import { spawn, type ChildProcess } from 'child_process'
import { join, resolve } from 'path'
import { execPortAsync, prepareSample } from './utils'
import { describe, test, expect, afterEach } from 'vitest'

const TIMEOUT = 15000 // 15 seconds should be plenty for host processes

describe('port run integration', () => {
  // Track spawned processes for cleanup
  const spawnedProcesses: ChildProcess[] = []

  afterEach(async () => {
    // Kill all spawned processes
    for (const proc of spawnedProcesses) {
      try {
        proc.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    spawnedProcesses.length = 0
  })

  test(
    'two worktrees can run services on the same logical port',
    async () => {
      const sample = await prepareSample('simple-server', {
        initWithConfig: true,
      })

      // Create worktrees A and B
      await execPortAsync(['A', '--no-shell'], sample.dir)
      await execPortAsync(['B', '--no-shell'], sample.dir)

      const worktreeADir = join(sample.dir, '.port/trees/a')
      const worktreeBDir = join(sample.dir, '.port/trees/b')

      // Spawn `port run 3000 -- bun index.ts` in each worktree as background processes
      const procA = spawnPortRun(3000, ['bun', 'index.ts'], worktreeADir)
      const procB = spawnPortRun(3000, ['bun', 'index.ts'], worktreeBDir)
      spawnedProcesses.push(procA, procB)

      // Poll until both services respond
      const aURL = 'http://a.port:3000'
      const bURL = 'http://b.port:3000'

      const [responseA, responseB] = await Promise.all([pollUntilReady(aURL), pollUntilReady(bURL)])

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
async function pollUntilReady(url: string, timeoutMs = 10000): Promise<Response> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url)
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

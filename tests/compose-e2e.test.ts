import { describe, expect, test } from 'vitest'
import { execAsync } from '../src/lib/exec'
import { execPortAsync, prepareSample, safeDown } from './utils'

const TIMEOUT = 120000

async function waitForTraefikRunning(maxWaitMs = 60000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    const { stdout } = await execAsync('docker ps --filter name=port-traefik --format "{{.Names}}"')
    if (stdout.trim() === 'port-traefik') {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  throw new Error('Timed out waiting for Traefik to start')
}

async function hasDockerDaemon(): Promise<boolean> {
  try {
    await execAsync('docker info >/dev/null 2>&1')
    return true
  } catch {
    return false
  }
}

describe.sequential('port compose e2e', () => {
  test(
    'starts Traefik and prints a notice when it is down',
    async () => {
      if (!(await hasDockerDaemon())) {
        return
      }

      const sample = await prepareSample('db-and-server', { initWithConfig: true })

      try {
        await execAsync('docker rm -f port-traefik 2>/dev/null || true')

        const result = await execPortAsync(['compose', 'up', '-d'], sample.dir)

        expect(result.stderr).toContain('Starting Traefik...')

        await waitForTraefikRunning()

        const { stdout } = await execAsync(
          'docker ps --filter name=port-traefik --format "{{.Names}}"'
        )
        expect(stdout.trim()).toBe('port-traefik')
      } finally {
        await safeDown(sample.dir)
        await sample.cleanup()
      }
    },
    TIMEOUT
  )
})

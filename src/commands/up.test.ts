import { waitFor } from 'cli-testing-library'
import { createConnection } from 'net'
import { describe, test, expect } from 'vitest'
import { checkDns } from '../lib/dns'
import { prepareSample, renderCLI } from '../../tests/utils'

const SAMPLES_TIMEOUT = 60_000

async function probePostgresSslResponse(
  host: string,
  port: number,
  retries = 20,
  delayMs = 2000
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const socket = createConnection({ host, port })
        const timeout = setTimeout(() => {
          socket.destroy()
          reject(new Error(`Timed out probing Postgres at ${host}:${port}`))
        }, 5000)

        socket.once('error', error => {
          clearTimeout(timeout)
          reject(error)
        })

        socket.once('connect', () => {
          // PostgreSQL SSLRequest packet (length=8, code=80877103)
          socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]))
        })

        socket.once('data', data => {
          clearTimeout(timeout)
          const response = data.subarray(0, 1).toString('ascii')
          socket.end()
          resolve(response)
        })
      })
    } catch (error) {
      if (attempt === retries) throw error
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw new Error('unreachable')
}

describe('samples start', () => {
  test(
    'start the db-and-server sample',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      const { findByError } = await renderCLI(['up'], sample.dir)

      const instance = await findByError(
        'Traefik dashboard:',
        {},
        {
          timeout: SAMPLES_TIMEOUT,
        }
      )
      expect(instance).toBeInTheConsole()

      // Confirm that the domain is reachable
      const res = await fetch(sample.urlWithPort(3000))
      setInterval(() => {
        // Keep checking until the status is 200
        if (res.status === 200) {
          clearInterval()
        }
      }, 1000)

      // End the sample (use -y to skip Traefik confirmation prompt)
      const downInstance = await renderCLI(['down', '-y'], sample.dir)
      await waitFor(() => expect(downInstance.hasExit()).toMatchObject({ exitCode: 0 }), {
        timeout: SAMPLES_TIMEOUT,
      })
      await sample.cleanup()
    },
    SAMPLES_TIMEOUT + 1000
  )

  test(
    'start the db-and-server sample with a custom domain',
    async ctx => {
      const dnsConfigured = await checkDns('test')
      if (!dnsConfigured) {
        if (process.env.CI) {
          throw new Error(
            'DNS is not configured for the .test domain in CI. ' +
              'Ensure `port install --domain test -y` runs before tests.'
          )
        }
        ctx.skip()
      }

      const sample = await prepareSample('db-and-server', {
        initWithConfig: { domain: 'test' },
      })

      try {
        const { findByError } = await renderCLI(['up'], sample.dir)

        await findByError('Traefik dashboard:', {}, { timeout: SAMPLES_TIMEOUT })

        // Confirm that the custom domain is reachable (retry until Traefik routes are ready)
        await waitFor(
          async () => {
            const res = await fetch(sample.urlWithPort(3000))
            expect(res.status).toBe(200)
          },
          { timeout: SAMPLES_TIMEOUT }
        )

        const downInstance = await renderCLI(['down', '-y'], sample.dir)
        await waitFor(() => expect(downInstance.hasExit()).toMatchObject({ exitCode: 0 }), {
          timeout: SAMPLES_TIMEOUT,
        })
      } finally {
        await sample.cleanup()
      }
    },
    SAMPLES_TIMEOUT + 1000
  )

  test(
    'routes postgres traffic through the .port domain',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      try {
        const { findByError } = await renderCLI(['up'], sample.dir)

        await findByError('Traefik dashboard:', {}, { timeout: SAMPLES_TIMEOUT })

        const postgresHost = new URL(sample.urlWithPort(5432)).hostname
        const sslResponse = await probePostgresSslResponse(postgresHost, 5432)

        expect(['S', 'N']).toContain(sslResponse)

        const downInstance = await renderCLI(['down', '-y'], sample.dir)
        await waitFor(() => expect(downInstance.hasExit()).toMatchObject({ exitCode: 0 }), {
          timeout: SAMPLES_TIMEOUT,
        })
      } finally {
        await sample.cleanup()
      }
    },
    SAMPLES_TIMEOUT + 1000
  )
})

describe('docker compose output streaming', () => {
  test(
    'port up streams docker compose output',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      const { findByError } = await renderCLI(['up'], sample.dir)

      // Docker compose outputs "Started" when containers start.
      // This confirms docker compose output is being streamed to the terminal.
      const startedOutput = await findByError('Started', {}, { timeout: SAMPLES_TIMEOUT })
      expect(startedOutput).toBeInTheConsole()

      // Wait for completion and cleanup
      await findByError('Traefik dashboard:', {}, { timeout: SAMPLES_TIMEOUT })
      const downInstance = await renderCLI(['down', '-y'], sample.dir)
      await waitFor(() => expect(downInstance.hasExit()).toMatchObject({ exitCode: 0 }), {
        timeout: SAMPLES_TIMEOUT,
      })
      await sample.cleanup()
    },
    SAMPLES_TIMEOUT + 1000
  )

  test(
    'port down streams docker compose output',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      // First start the services
      const upInstance = await renderCLI(['up'], sample.dir)
      await upInstance.findByError('Traefik dashboard:', {}, { timeout: SAMPLES_TIMEOUT })

      // Now test that down streams docker compose output
      const { findByError } = await renderCLI(['down', '-y'], sample.dir)

      // Docker compose outputs "Stopping" when containers stop.
      // This confirms docker compose output is being streamed to the terminal.
      const stoppingOutput = await findByError('Stopping', {}, { timeout: SAMPLES_TIMEOUT })
      expect(stoppingOutput).toBeInTheConsole()

      await sample.cleanup()
    },
    SAMPLES_TIMEOUT * 2 // Need extra time since we run both up and down
  )
})

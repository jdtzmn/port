import { waitFor } from 'cli-testing-library'
import { describe, test, expect } from 'vitest'
import { prepareSample, renderCLI } from '../../tests/utils'

const SAMPLES_TIMEOUT = 30_000

describe('samples start', () => {
  test(
    'start the db-and-server sample',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      const { findByText } = await renderCLI(['up'], sample.dir)

      const instance = await findByText(
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
})

describe('docker compose output streaming', () => {
  test(
    'port up streams docker compose output',
    async () => {
      const sample = await prepareSample('db-and-server', {
        initWithConfig: true,
      })

      const { findByText } = await renderCLI(['up'], sample.dir)

      // Docker compose outputs "Started" when containers start.
      // This confirms docker compose output is being streamed to the terminal.
      const startedOutput = await findByText('Started', {}, { timeout: SAMPLES_TIMEOUT })
      expect(startedOutput).toBeInTheConsole()

      // Wait for completion and cleanup
      await findByText('Traefik dashboard:', {}, { timeout: SAMPLES_TIMEOUT })
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
      await upInstance.findByText('Traefik dashboard:', {}, { timeout: SAMPLES_TIMEOUT })

      // Now test that down streams docker compose output
      const { findByText } = await renderCLI(['down', '-y'], sample.dir)

      // Docker compose outputs "Stopping" when containers stop.
      // This confirms docker compose output is being streamed to the terminal.
      const stoppingOutput = await findByText('Stopping', {}, { timeout: SAMPLES_TIMEOUT })
      expect(stoppingOutput).toBeInTheConsole()

      await sample.cleanup()
    },
    SAMPLES_TIMEOUT * 2 // Need extra time since we run both up and down
  )
})

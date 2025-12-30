import { basename } from 'node:path'
import { waitFor } from 'cli-testing-library'
import { describe, test, expect } from 'vitest'
import { prepareSample, renderCLI } from '../../tests/utils'
import { sanitizeFolderName } from '../lib/sanitize'

const SAMPLES_TIMEOUT = 20_000

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
      const sampleDir = sanitizeFolderName(basename(sample.dir))
      const url = `http://${sampleDir}.port:3000`
      const res = await fetch(url)
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
      sample.cleanup()
    },
    SAMPLES_TIMEOUT + 1000
  )
})

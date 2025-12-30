import { waitFor } from 'cli-testing-library'
import { describe, test, expect } from 'vitest'
import { prepareSample, renderCLI } from '../../tests/utils'
import { execAsync } from '../lib/exec.ts'

describe('samples start', () => {
  test('should start the db-and-server sample', async () => {
    const sample = await prepareSample('db-and-server')

    // Set up git and init the project
    await execAsync('git init', {
      cwd: sample.dir,
    })
    const initInstance = await renderCLI(['init'], sample.dir)
    await waitFor(() => expect(initInstance.hasExit()).toMatchObject({ exitCode: 0 }))

    const { findByText } = await renderCLI(['up'], sample.dir)

    const instance = await findByText(
      'Traefik dashboard:',
      {},
      {
        timeout: 19000,
      }
    )
    expect(instance).toBeInTheConsole()

    // End the sample (use -y to skip Traefik confirmation prompt)
    const downInstance = await renderCLI(['down', '-y'], sample.dir)
    await waitFor(() => expect(downInstance.hasExit()).toMatchObject({ exitCode: 0 }), {
      timeout: 19000,
    })
    sample.cleanup()
  }, 20000)
})

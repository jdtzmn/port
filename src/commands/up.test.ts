import { waitFor } from 'cli-testing-library'
import { exec } from 'child_process'
import { promisify } from 'util'
import { describe, test, expect } from 'vitest'
import { prepareSample, renderCLI } from '../../tests/utils'

const execAsync = promisify(exec)

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
        timeout: 15000,
      }
    )
    expect(instance).toBeInTheConsole()

    // End the sample (use -y to skip Traefik confirmation prompt)
    const downInstance = await renderCLI(['down', '-y'], sample.dir)
    await waitFor(() => expect(downInstance.hasExit()).toMatchObject({ exitCode: 0 }), {
      timeout: 30000,
    })
    sample.cleanup()
  }, 20000)
})

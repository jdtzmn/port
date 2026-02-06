import { describe, test, expect } from 'vitest'
import { prepareSample, renderCLI } from '@tests/utils'

describe('port kill command', () => {
  test('errors when not in a port-managed project', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
    })

    const { findByError } = await renderCLI(['kill'], sample.dir)

    const instance = await findByError('Port not initialized')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })

  test('errors with invalid port number', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
      initWithConfig: true,
    })

    const { findByError } = await renderCLI(['kill', 'invalid'], sample.dir)

    const instance = await findByError('Invalid port number')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })

  test('shows info when no host services are running', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
      initWithConfig: true,
    })

    const { findByText } = await renderCLI(['kill'], sample.dir)

    const instance = await findByText('No active host services found')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })
})

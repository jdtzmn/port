import { describe, test, expect } from 'vitest'
import { prepareSample, renderCLI } from '@tests/utils'
import { useIsolatedPortGlobalDir } from '@tests/isolatedGlobalDir'

describe('port kill command', () => {
  useIsolatedPortGlobalDir('port-kill-test')

  test('can run outside a port-managed project and reports no services', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
    })

    const { findByError } = await renderCLI(['kill'], sample.dir)

    const instance = await findByError('No active host services found')
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

    const { findByError } = await renderCLI(['kill'], sample.dir)

    const instance = await findByError('No active host services found')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })

  test('shows logical port specific message when none are running', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
      initWithConfig: true,
    })

    const { findByError } = await renderCLI(['kill', '3000'], sample.dir)

    const instance = await findByError('No active host services found on logical port 3000')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })
})

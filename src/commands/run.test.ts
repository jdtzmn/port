import { test, expect, describe } from 'vitest'
import { prepareSample, renderCLI } from '@tests/utils'

describe('port run command', () => {
  test('errors when not in a port-managed project', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
    })

    const { findByError } = await renderCLI(['run', '3000', '--', 'echo', 'hello'], sample.dir)

    const instance = await findByError('Port not initialized')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })

  test('errors when no command is provided', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
      initWithConfig: true,
    })

    const { findByError } = await renderCLI(['run', '3000'], sample.dir)

    const instance = await findByError('No command specified')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })

  test('errors with invalid port number', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
      initWithConfig: true,
    })

    const { findByError } = await renderCLI(['run', 'invalid', '--', 'echo', 'hello'], sample.dir)

    const instance = await findByError('Invalid port number')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })

  test('errors with port number out of range', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
      initWithConfig: true,
    })

    const { findByError } = await renderCLI(['run', '99999', '--', 'echo', 'hello'], sample.dir)

    const instance = await findByError('Invalid port number')
    expect(instance).toBeInTheConsole()

    await sample.cleanup()
  })
})

describe('Traefik config generation', () => {
  test('generateTraefikConfig includes file provider', async () => {
    // Import the function directly to test
    const { generateTraefikConfig } = await import('../lib/traefik.ts')

    const config = generateTraefikConfig([3000, 8080])

    expect(config.providers.file).toBeDefined()
    expect(config.providers.file?.directory).toBe('/etc/traefik/dynamic')
    expect(config.providers.file?.watch).toBe(true)
  })

  test('generateTraefikConfig includes docker provider', async () => {
    const { generateTraefikConfig } = await import('../lib/traefik.ts')

    const config = generateTraefikConfig([3000])

    expect(config.providers.docker).toBeDefined()
    expect(config.providers.docker.exposedByDefault).toBe(false)
    expect(config.providers.docker.network).toBe('traefik-network')
  })

  test('generateTraefikConfig creates entrypoints for ports', async () => {
    const { generateTraefikConfig } = await import('../lib/traefik.ts')

    const config = generateTraefikConfig([3000, 8080])

    expect(config.entryPoints.web?.address).toBe(':80')
    expect(config.entryPoints.port3000?.address).toBe(':3000')
    expect(config.entryPoints.port8080?.address).toBe(':8080')
  })
})

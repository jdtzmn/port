import { test, expect, describe, beforeAll, beforeEach } from 'vitest'
import { useIsolatedPortGlobalDir } from '@tests/isolatedGlobalDir'

type RegistryModule = typeof import('./registry.ts')
type ServiceStatusModule = typeof import('./serviceStatus.ts')

let registry: RegistryModule
let serviceStatus: ServiceStatusModule

describe('branchHasRunningServices', () => {
  const { getDir } = useIsolatedPortGlobalDir('port-service-status-test', {
    resetModules: true,
  })

  beforeAll(async () => {
    registry = await import('./registry.ts')
    serviceStatus = await import('./serviceStatus.ts')
  })

  beforeEach(async () => {
    await registry.saveRegistry({ projects: [], hostServices: [] })
  })

  test('returns true when a registered host service process is alive', async () => {
    await registry.registerHostService({
      repo: '/test/repo',
      branch: 'old-name',
      logicalPort: 3000,
      actualPort: 49152,
      pid: process.pid,
      configFile: '/tmp/old-name-3000.yml',
    })

    await expect(
      serviceStatus.branchHasRunningServices(
        '/test/repo',
        'old-name',
        'missing-compose.yml',
        'port'
      )
    ).resolves.toBe(true)
  })

  test('returns false when no services are registered and compose is unavailable', async () => {
    await expect(
      serviceStatus.branchHasRunningServices(
        '/test/repo',
        'old-name',
        'missing-compose.yml',
        'port'
      )
    ).resolves.toBe(false)
  })

  test('uses isolated global registry path in tests', () => {
    expect(getDir()).toBeDefined()
  })
})

import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { dirname } from 'path'
import {
  loadRegistry,
  saveRegistry,
  registerProject,
  getAllProjects,
  registerHostService,
  unregisterHostService,
  getHostService,
  getHostServicesForWorktree,
  getAllHostServices,
  REGISTRY_FILE,
} from './registry.ts'
import type { Registry, HostService } from '../types.ts'

// Helper to create a mock host service
function createMockHostService(overrides: Partial<HostService> = {}): HostService {
  return {
    repo: '/test/repo',
    branch: 'test-branch',
    logicalPort: 3000,
    actualPort: 49152,
    pid: 12345,
    configFile: '/test/config.yml',
    ...overrides,
  }
}

describe('Host Service Registry Functions', () => {
  let originalRegistry: Registry | null = null

  test('uses isolated global registry path in tests', () => {
    const isolatedDir = process.env.PORT_GLOBAL_DIR
    expect(isolatedDir).toBeTruthy()
    expect(dirname(REGISTRY_FILE)).toBe(isolatedDir)
  })

  beforeEach(async () => {
    // Backup existing registry if it exists
    if (existsSync(REGISTRY_FILE)) {
      const content = await readFile(REGISTRY_FILE, 'utf-8')
      originalRegistry = JSON.parse(content)
    }

    // Clear registry for tests
    await saveRegistry({ projects: [], hostServices: [] })
  })

  afterEach(async () => {
    // Restore original registry
    if (originalRegistry) {
      await saveRegistry(originalRegistry)
    } else if (existsSync(REGISTRY_FILE)) {
      // Clear the registry if there wasn't one before
      await saveRegistry({ projects: [], hostServices: [] })
    }
  })

  describe('loadRegistry', () => {
    test('returns empty hostServices array for new registry', async () => {
      const registry = await loadRegistry()

      expect(registry.hostServices).toBeDefined()
      expect(registry.hostServices).toEqual([])
    })

    test('preserves existing hostServices', async () => {
      const service = createMockHostService()
      await saveRegistry({ projects: [], hostServices: [service] })

      const registry = await loadRegistry()

      expect(registry.hostServices).toHaveLength(1)
      expect(registry.hostServices![0]).toEqual(service)
    })
  })

  describe('registerHostService', () => {
    test('adds a new host service', async () => {
      const service = createMockHostService()

      await registerHostService(service)

      const registry = await loadRegistry()
      expect(registry.hostServices).toHaveLength(1)
      expect(registry.hostServices![0]).toEqual(service)
    })

    test('updates existing host service with same repo/branch/port', async () => {
      const service1 = createMockHostService({ actualPort: 49152, pid: 111 })
      const service2 = createMockHostService({ actualPort: 49153, pid: 222 })

      await registerHostService(service1)
      await registerHostService(service2)

      const registry = await loadRegistry()
      expect(registry.hostServices).toHaveLength(1)
      expect(registry.hostServices?.[0]?.actualPort).toBe(49153)
      expect(registry.hostServices?.[0]?.pid).toBe(222)
    })

    test('allows different ports for same branch', async () => {
      const service1 = createMockHostService({ logicalPort: 3000 })
      const service2 = createMockHostService({ logicalPort: 8080 })

      await registerHostService(service1)
      await registerHostService(service2)

      const registry = await loadRegistry()
      expect(registry.hostServices).toHaveLength(2)
    })

    test('allows same port for different branches', async () => {
      const service1 = createMockHostService({ branch: 'feature-1' })
      const service2 = createMockHostService({ branch: 'feature-2' })

      await registerHostService(service1)
      await registerHostService(service2)

      const registry = await loadRegistry()
      expect(registry.hostServices).toHaveLength(2)
    })

    test('keeps all concurrent host service registrations', async () => {
      const services = Array.from({ length: 20 }, (_, index) =>
        createMockHostService({
          branch: `feature-${index}`,
          logicalPort: 3000 + index,
          actualPort: 49152 + index,
          pid: 1000 + index,
        })
      )

      await Promise.all(services.map(service => registerHostService(service)))

      const allServices = await getAllHostServices()
      expect(allServices).toHaveLength(20)
      expect(allServices.map(service => service.logicalPort).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, index) => 3000 + index)
      )
    })
  })

  describe('project registry concurrency', () => {
    test('keeps all concurrent project registrations', async () => {
      const repo = '/test/repo'
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          registerProject(repo, `branch-${index}`, [3000 + index])
        )
      )

      const projects = await getAllProjects()
      expect(projects).toHaveLength(20)
      expect(projects.map(project => project.branch).sort()).toEqual(
        Array.from({ length: 20 }, (_, index) => `branch-${index}`).sort()
      )
    })
  })

  describe('unregisterHostService', () => {
    test('removes a host service', async () => {
      const service = createMockHostService()
      await registerHostService(service)

      await unregisterHostService(service.repo, service.branch, service.logicalPort)

      const registry = await loadRegistry()
      expect(registry.hostServices).toHaveLength(0)
    })

    test('does not throw when service does not exist', async () => {
      await expect(unregisterHostService('/nonexistent', 'branch', 3000)).resolves.not.toThrow()
    })

    test('only removes matching service', async () => {
      const service1 = createMockHostService({ branch: 'feature-1' })
      const service2 = createMockHostService({ branch: 'feature-2' })
      await registerHostService(service1)
      await registerHostService(service2)

      await unregisterHostService(service1.repo, service1.branch, service1.logicalPort)

      const registry = await loadRegistry()
      expect(registry.hostServices).toHaveLength(1)
      expect(registry.hostServices?.[0]?.branch).toBe('feature-2')
    })
  })

  describe('getHostService', () => {
    test('returns undefined when not found', async () => {
      const result = await getHostService('/test/repo', 'branch', 3000)

      expect(result).toBeUndefined()
    })

    test('returns the host service when found', async () => {
      const service = createMockHostService()
      await registerHostService(service)

      const result = await getHostService(service.repo, service.branch, service.logicalPort)

      expect(result).toEqual(service)
    })
  })

  describe('getHostServicesForWorktree', () => {
    test('returns empty array when no services', async () => {
      const result = await getHostServicesForWorktree('/test/repo', 'branch')

      expect(result).toEqual([])
    })

    test('returns all services for a worktree', async () => {
      const service1 = createMockHostService({ logicalPort: 3000 })
      const service2 = createMockHostService({ logicalPort: 8080 })
      const service3 = createMockHostService({ branch: 'other-branch' })
      await registerHostService(service1)
      await registerHostService(service2)
      await registerHostService(service3)

      const result = await getHostServicesForWorktree('/test/repo', 'test-branch')

      expect(result).toHaveLength(2)
      expect(result.map(s => s.logicalPort).sort()).toEqual([3000, 8080])
    })
  })

  describe('getAllHostServices', () => {
    test('returns empty array when no services', async () => {
      const result = await getAllHostServices()

      expect(result).toEqual([])
    })

    test('returns all host services', async () => {
      const service1 = createMockHostService({ branch: 'feature-1' })
      const service2 = createMockHostService({ branch: 'feature-2' })
      await registerHostService(service1)
      await registerHostService(service2)

      const result = await getAllHostServices()

      expect(result).toHaveLength(2)
    })
  })
})

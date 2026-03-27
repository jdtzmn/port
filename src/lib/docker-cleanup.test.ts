import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TRAEFIK_NETWORK } from './traefik.ts'
import type { DockerCleanupOptions } from '../types.ts'
import * as exec from './exec.ts'

// Import the module we're testing
import {
  isDockerAvailable,
  listProjectVolumes,
  listProjectNetworks,
  listProjectContainers,
  listProjectImages,
  removeVolume,
  removeNetwork,
  removeContainer,
  removeImage,
  cleanupDockerResources,
  scanDockerResourcesForProject,
} from './docker-cleanup.ts'

describe('docker-cleanup', () => {
  let execAsyncSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    execAsyncSpy = vi.spyOn(exec, 'execAsync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isDockerAvailable', () => {
    test('returns true when docker info succeeds', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: 'Docker info', stderr: '' })

      const result = await isDockerAvailable()

      expect(result).toBe(true)
      expect(execAsyncSpy).toHaveBeenCalledWith('docker info', { timeout: 5000 })
    })

    test('returns false when docker info fails', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Docker not available'))

      const result = await isDockerAvailable()

      expect(result).toBe(false)
    })

    test('returns false on timeout', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Timeout'))

      const result = await isDockerAvailable()

      expect(result).toBe(false)
    })
  })

  describe('listProjectVolumes', () => {
    test('returns empty array when no volumes found', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await listProjectVolumes('test-project')

      expect(result).toEqual([])
      expect(execAsyncSpy).toHaveBeenCalledWith(
        "docker volume ls --filter label=com.docker.compose.project='test-project' --quiet"
      )
    })

    test('returns list of volume names for project', async () => {
      execAsyncSpy.mockResolvedValue({
        stdout: 'test-project_db\ntest-project_cache\n',
        stderr: '',
      })

      const result = await listProjectVolumes('test-project')

      expect(result).toEqual(['test-project_db', 'test-project_cache'])
    })

    test('filters by compose project label', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await listProjectVolumes('my-project')

      expect(execAsyncSpy).toHaveBeenCalledWith(
        "docker volume ls --filter label=com.docker.compose.project='my-project' --quiet"
      )
    })

    test('handles docker command errors gracefully', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Docker error'))

      const result = await listProjectVolumes('test-project')

      expect(result).toEqual([])
    })
  })

  describe('listProjectNetworks', () => {
    test('returns empty array when no networks found', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await listProjectNetworks('test-project')

      expect(result).toEqual([])
    })

    test('returns list of network names for project', async () => {
      execAsyncSpy.mockResolvedValue({
        stdout: 'test-project_default\ntest-project_backend\n',
        stderr: '',
      })

      const result = await listProjectNetworks('test-project')

      expect(result).toEqual(['test-project_default', 'test-project_backend'])
    })

    test('excludes traefik-network even if labeled (CRITICAL SAFETY CHECK)', async () => {
      execAsyncSpy.mockResolvedValue({
        stdout: `test-project_default\n${TRAEFIK_NETWORK}\ntest-project_backend\n`,
        stderr: '',
      })

      const result = await listProjectNetworks('test-project')

      expect(result).toEqual(['test-project_default', 'test-project_backend'])
      expect(result).not.toContain(TRAEFIK_NETWORK)
    })

    test('filters by compose project label', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await listProjectNetworks('my-project')

      expect(execAsyncSpy).toHaveBeenCalledWith(
        'docker network ls --filter label=com.docker.compose.project=\'my-project\' --quiet --format "{{.Name}}"'
      )
    })

    test('handles docker command errors gracefully', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Docker error'))

      const result = await listProjectNetworks('test-project')

      expect(result).toEqual([])
    })
  })

  describe('listProjectContainers', () => {
    test('returns empty array when no containers found', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await listProjectContainers('test-project')

      expect(result).toEqual([])
    })

    test('returns list of container IDs for project', async () => {
      execAsyncSpy.mockResolvedValue({
        stdout: 'abc123def456\n789ghi012jkl\n',
        stderr: '',
      })

      const result = await listProjectContainers('test-project')

      expect(result).toEqual(['abc123def456', '789ghi012jkl'])
    })

    test('includes stopped containers', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await listProjectContainers('test-project')

      expect(execAsyncSpy).toHaveBeenCalledWith(
        "docker ps -a --filter label=com.docker.compose.project='test-project' --quiet"
      )
    })

    test('filters by compose project label', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await listProjectContainers('my-project')

      expect(execAsyncSpy).toHaveBeenCalledWith(
        "docker ps -a --filter label=com.docker.compose.project='my-project' --quiet"
      )
    })

    test('handles docker command errors gracefully', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Docker error'))

      const result = await listProjectContainers('test-project')

      expect(result).toEqual([])
    })
  })

  describe('listProjectImages', () => {
    test('returns empty array when no images found', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await listProjectImages('test-project')

      expect(result).toEqual([])
    })

    test('returns array of {id, name} objects', async () => {
      execAsyncSpy.mockResolvedValue({
        stdout: 'abc123|postgres:14\ndef456|redis:7\n',
        stderr: '',
      })

      const result = await listProjectImages('test-project')

      expect(result).toEqual([
        { id: 'abc123', name: 'postgres:14' },
        { id: 'def456', name: 'redis:7' },
      ])
    })

    test('handles <none> tagged images', async () => {
      execAsyncSpy.mockResolvedValue({
        stdout: 'abc123|<none>:<none>\n',
        stderr: '',
      })

      const result = await listProjectImages('test-project')

      expect(result).toEqual([{ id: 'abc123', name: '<none>:<none>' }])
    })

    test('filters by compose project label', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await listProjectImages('my-project')

      expect(execAsyncSpy).toHaveBeenCalledWith(
        'docker images --filter label=com.docker.compose.project=\'my-project\' --format "{{.ID}}|{{.Repository}}:{{.Tag}}"'
      )
    })

    test('handles docker command errors gracefully', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Docker error'))

      const result = await listProjectImages('test-project')

      expect(result).toEqual([])
    })
  })

  describe('removeVolume', () => {
    test('executes docker volume rm command', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeVolume('test-volume')

      expect(execAsyncSpy).toHaveBeenCalledWith("docker volume rm 'test-volume'")
    })

    test('throws on error', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Volume in use'))

      await expect(removeVolume('test-volume')).rejects.toThrow('Volume in use')
    })
  })

  describe('removeNetwork', () => {
    test('executes docker network rm command', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeNetwork('test-network')

      expect(execAsyncSpy).toHaveBeenCalledWith("docker network rm 'test-network'")
    })

    test('throws on error', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Network in use'))

      await expect(removeNetwork('test-network')).rejects.toThrow('Network in use')
    })
  })

  describe('removeContainer', () => {
    test('executes docker rm command', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeContainer('abc123')

      expect(execAsyncSpy).toHaveBeenCalledWith("docker rm 'abc123'")
    })

    test('throws on error', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Container not found'))

      await expect(removeContainer('abc123')).rejects.toThrow('Container not found')
    })
  })

  describe('removeImage', () => {
    test('executes docker rmi command', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeImage('abc123')

      expect(execAsyncSpy).toHaveBeenCalledWith("docker rmi 'abc123'")
    })

    test('throws on error', async () => {
      execAsyncSpy.mockRejectedValue(new Error('Image in use'))

      await expect(removeImage('abc123')).rejects.toThrow('Image in use')
    })
  })

  describe('cleanupDockerResources', () => {
    beforeEach(() => {
      // Setup default mocks for successful cleanup
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker info')) {
          return { stdout: 'ok', stderr: '' }
        }
        if (cmd.includes('docker volume ls')) {
          return { stdout: 'vol1\nvol2\n', stderr: '' }
        }
        if (cmd.includes('docker network ls')) {
          return { stdout: 'net1\n', stderr: '' }
        }
        if (cmd.includes('docker ps -a')) {
          return { stdout: 'container1\ncontainer2\n', stderr: '' }
        }
        if (cmd.includes('docker images')) {
          return { stdout: 'img1|postgres:14\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
    })

    test('removes volumes, networks, containers when skipImages=true', async () => {
      const result = await cleanupDockerResources('test-project', { skipImages: true })

      expect(result.volumesRemoved).toBe(2)
      expect(result.networksRemoved).toBe(1)
      expect(result.containersRemoved).toBe(2)
      expect(result.imagesRemoved).toBe(0)
      expect(result.totalRemoved).toBe(5)
    })

    test('removes all resources when skipImages=false', async () => {
      const result = await cleanupDockerResources('test-project', { skipImages: false })

      expect(result.volumesRemoved).toBe(2)
      expect(result.networksRemoved).toBe(1)
      expect(result.containersRemoved).toBe(2)
      expect(result.imagesRemoved).toBe(1)
      expect(result.totalRemoved).toBe(6)
    })

    test('skips cleanup when Docker unavailable', async () => {
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker info')) {
          throw new Error('Docker not available')
        }
        return { stdout: '', stderr: '' }
      })

      const result = await cleanupDockerResources('test-project')

      expect(result.dockerAvailable).toBe(false)
      expect(result.totalRemoved).toBe(0)
      expect(result.warnings).toContain('Docker daemon not available - skipping cleanup')
    })

    test('collects warnings for failed removals', async () => {
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker info')) {
          return { stdout: 'ok', stderr: '' }
        }
        if (cmd.includes('docker volume ls')) {
          return { stdout: 'vol1\n', stderr: '' }
        }
        if (cmd.includes('docker volume rm')) {
          throw new Error('Volume in use')
        }
        return { stdout: '', stderr: '' }
      })

      const result = await cleanupDockerResources('test-project')

      expect(result.volumesRemoved).toBe(0)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain('Failed to remove volume')
    })

    test('continues after individual resource failures (non-fatal guarantee)', async () => {
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker info')) {
          return { stdout: 'ok', stderr: '' }
        }
        if (cmd.includes('docker volume ls')) {
          return { stdout: 'vol1\nvol2\n', stderr: '' }
        }
        if (cmd.includes("docker volume rm 'vol1'")) {
          throw new Error('Failed')
        }
        if (cmd.includes('docker network ls')) {
          return { stdout: 'net1\n', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      const result = await cleanupDockerResources('test-project')

      // Should have removed vol2 and net1 despite vol1 failure
      expect(result.volumesRemoved).toBe(1) // vol2 succeeded
      expect(result.networksRemoved).toBe(1) // net1 succeeded
      expect(result.warnings.length).toBe(1) // vol1 failed
    })

    test('returns correct counts in result', async () => {
      const result = await cleanupDockerResources('test-project', { skipImages: false })

      expect(result).toMatchObject({
        volumesRemoved: 2,
        networksRemoved: 1,
        containersRemoved: 2,
        imagesRemoved: 1,
        totalRemoved: 6,
        dockerAvailable: true,
      })
    })

    test('respects quiet option (no output to console)', async () => {
      const result = await cleanupDockerResources('test-project', { quiet: true })

      // Should complete without errors
      expect(result.totalRemoved).toBeGreaterThan(0)
    })

    test('respects dryRun option (lists without removing)', async () => {
      const result = await cleanupDockerResources('test-project', {
        dryRun: true,
        skipImages: false,
      })

      // Should report what would be removed
      expect(result.totalRemoved).toBe(6)

      // Should NOT have called any rm commands
      expect(execAsyncSpy).not.toHaveBeenCalledWith(expect.stringContaining('docker volume rm'))
      expect(execAsyncSpy).not.toHaveBeenCalledWith(expect.stringContaining('docker network rm'))
      expect(execAsyncSpy).not.toHaveBeenCalledWith(expect.stringContaining('docker rm'))
      expect(execAsyncSpy).not.toHaveBeenCalledWith(expect.stringContaining('docker rmi'))
    })
  })

  describe('scanDockerResourcesForProject', () => {
    beforeEach(() => {
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker volume ls')) {
          return { stdout: 'vol1\nvol2\n', stderr: '' }
        }
        if (cmd.includes('docker network ls')) {
          return { stdout: 'net1\n', stderr: '' }
        }
        if (cmd.includes('docker ps -a')) {
          return { stdout: 'container1\n', stderr: '' }
        }
        if (cmd.includes('docker images')) {
          return { stdout: 'img1|postgres:14\nimg2|redis:7\n', stderr: '' }
        }
        if (cmd.includes('docker system df')) {
          return {
            stdout:
              'Images          2         1         1.5GB     500MB (33%)\n' +
              'Containers      3         2         10MB      5MB (50%)\n' +
              'Local Volumes   2         1         2GB       1GB (50%)\n' +
              'Build Cache     0         0         0B        0B\n',
            stderr: '',
          }
        }
        return { stdout: '', stderr: '' }
      })
    })

    test('returns all resource types for a project', async () => {
      const result = await scanDockerResourcesForProject('test-project')

      expect(result).toMatchObject({
        projectName: 'test-project',
        volumes: ['vol1', 'vol2'],
        networks: ['net1'],
        containers: ['container1'],
        images: [
          { id: 'img1', name: 'postgres:14' },
          { id: 'img2', name: 'redis:7' },
        ],
      })
    })

    test('returns zero counts when no resources found', async () => {
      execAsyncSpy.mockImplementation(async () => ({ stdout: '', stderr: '' }))

      const result = await scanDockerResourcesForProject('empty-project')

      expect(result).toMatchObject({
        projectName: 'empty-project',
        volumes: [],
        networks: [],
        containers: [],
        images: [],
      })
    })

    test('returns imageSize when images exist', async () => {
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker volume ls')) {
          return { stdout: '', stderr: '' }
        }
        if (cmd.includes('docker network ls')) {
          return { stdout: '', stderr: '' }
        }
        if (cmd.includes('docker ps -a')) {
          return { stdout: '', stderr: '' }
        }
        if (cmd.includes('docker images --filter')) {
          return { stdout: 'img1|postgres:14\nimg2|redis:7\n', stderr: '' }
        }
        if (cmd.includes('docker image inspect')) {
          // Mock docker image inspect returning size for each image (one per line)
          return {
            stdout: '800000000\n200000000\n', // 800MB and 200MB
            stderr: '',
          }
        }
        return { stdout: '', stderr: '' }
      })

      const result = await scanDockerResourcesForProject('test-project')

      expect(result.imageSize).toBe(1000000000) // 1GB total
    })

    test('returns undefined imageSize when no images exist', async () => {
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker images')) {
          return { stdout: '', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })

      const result = await scanDockerResourcesForProject('empty-project')

      expect(result.imageSize).toBeUndefined()
    })

    test('returns undefined imageSize when docker inspect fails', async () => {
      execAsyncSpy.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker images --filter')) {
          return { stdout: 'img1|postgres:14\n', stderr: '' }
        }
        if (cmd.includes('docker image inspect')) {
          throw new Error('Docker daemon error')
        }
        return { stdout: '', stderr: '' }
      })

      const result = await scanDockerResourcesForProject('test-project')

      expect(result.imageSize).toBeUndefined()
    })
  })

  describe('command injection safety', () => {
    test('escapes shell special characters in project names', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      // Project name with shell special characters that should be escaped
      await listProjectVolumes('test-project; rm -rf /')

      // Should wrap in single quotes to prevent injection
      const calls = execAsyncSpy.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls[0]).toContain("'test-project; rm -rf /'")
      expect(calls[0]).toContain('docker volume ls')
    })

    test('escapes special characters in volume names', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeVolume('test-volume; echo hacked')

      const calls = execAsyncSpy.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls[0]).toContain("'test-volume; echo hacked'")
      expect(calls[0]).toContain('docker volume rm')
    })

    test('escapes special characters in network names', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeNetwork('test-net$(whoami)')

      const calls = execAsyncSpy.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls[0]).toContain("'test-net$(whoami)'")
      expect(calls[0]).toContain('docker network rm')
    })

    test('escapes special characters in container IDs', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeContainer('abc123`cat /etc/passwd`')

      const calls = execAsyncSpy.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls[0]).toContain("'abc123`cat /etc/passwd`'")
      expect(calls[0]).toContain('docker rm')
    })

    test('escapes special characters in image IDs', async () => {
      execAsyncSpy.mockResolvedValue({ stdout: '', stderr: '' })

      await removeImage("abc123' || true #")

      const calls = execAsyncSpy.mock.calls.map((call: unknown[]) => call[0] as string)
      // Single quote is escaped as '\'' (end quote, escaped quote, start quote)
      expect(calls[0]).toContain("'abc123'\\'' || true #'")
      expect(calls[0]).toContain('docker rmi')
    })
  })
})

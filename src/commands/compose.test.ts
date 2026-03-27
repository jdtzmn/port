import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { compose } from './compose.ts'
import * as worktreeModule from '../lib/worktree.ts'
import * as configModule from '../lib/config.ts'
import * as composeModule from '../lib/compose.ts'
import * as output from '../lib/output.ts'

/**
 * Regression tests for port compose command pre-sync behavior.
 *
 * These tests verify:
 * 1. Override file synchronization happens BEFORE docker compose execution
 * 2. Parse failures abort execution with process.exit(1)
 * 3. Write failures abort execution with process.exit(1)
 * 4. Successful sync path proceeds to docker execution
 */

describe('port compose pre-sync behavior', () => {
  const mockWorktreeInfo = {
    repoRoot: '/repo',
    worktreePath: '/repo/.port/trees/feature-1',
    name: 'feature-1',
    isMainRepo: false,
  }

  const mockConfig = {
    domain: 'port',
  }

  const mockParsedCompose = {
    name: 'test-project',
    services: {
      web: {
        ports: [{ published: 3000, target: 3000 }],
      },
    },
  }

  // Mock process.exit to prevent test runner from exiting
  let mockExit: ReturnType<typeof vi.spyOn>
  let mockError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as any)
    mockError = vi.spyOn(output, 'error').mockImplementation(() => {})

    // Default mocks - tests will override as needed
    vi.spyOn(worktreeModule, 'detectWorktree').mockReturnValue(mockWorktreeInfo)
    vi.spyOn(configModule, 'ensurePortRuntimeDir').mockResolvedValue()
    vi.spyOn(configModule, 'loadConfigOrDefault').mockResolvedValue(mockConfig as any)
    vi.spyOn(configModule, 'getComposeFile').mockReturnValue('docker-compose.yml')
    vi.spyOn(composeModule, 'parseComposeFile').mockResolvedValue(mockParsedCompose as any)
    vi.spyOn(composeModule, 'writeOverrideFile').mockResolvedValue()
    vi.spyOn(composeModule, 'getProjectName').mockReturnValue('repo-feature-1')
    vi.spyOn(composeModule, 'runCompose').mockResolvedValue({ exitCode: 0 } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('parseComposeFile synchronization', () => {
    test('calls parseComposeFile before runCompose', async () => {
      const parseComposeFileSpy = vi.spyOn(composeModule, 'parseComposeFile')
      const runComposeSpy = vi.spyOn(composeModule, 'runCompose')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws in our mock
      }

      expect(parseComposeFileSpy).toHaveBeenCalled()
      expect(runComposeSpy).toHaveBeenCalled()

      // Verify parseComposeFile was called BEFORE runCompose
      const parseOrder = parseComposeFileSpy.mock.invocationCallOrder[0]!
      const runOrder = runComposeSpy.mock.invocationCallOrder[0]!
      expect(parseOrder).toBeLessThan(runOrder)
    })

    test('aborts on parseComposeFile failure with exit code 1', async () => {
      const parseError = new Error('YAML syntax error')
      vi.spyOn(composeModule, 'parseComposeFile').mockRejectedValue(parseError)
      const runComposeSpy = vi.spyOn(composeModule, 'runCompose')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws
      }

      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse compose file')
      )
      expect(mockExit).toHaveBeenCalledWith(1)
      expect(runComposeSpy).not.toHaveBeenCalled()
    })
  })

  describe('writeOverrideFile synchronization', () => {
    test('calls writeOverrideFile before runCompose', async () => {
      const writeOverrideFileSpy = vi.spyOn(composeModule, 'writeOverrideFile')
      const runComposeSpy = vi.spyOn(composeModule, 'runCompose')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws in our mock
      }

      expect(writeOverrideFileSpy).toHaveBeenCalled()
      expect(runComposeSpy).toHaveBeenCalled()

      // Verify writeOverrideFile was called BEFORE runCompose
      const writeOrder = writeOverrideFileSpy.mock.invocationCallOrder[0]!
      const runOrder = runComposeSpy.mock.invocationCallOrder[0]!
      expect(writeOrder).toBeLessThan(runOrder)
    })

    test('aborts on writeOverrideFile failure with exit code 1', async () => {
      const writeError = new Error('Permission denied')
      vi.spyOn(composeModule, 'writeOverrideFile').mockRejectedValue(writeError)
      const runComposeSpy = vi.spyOn(composeModule, 'runCompose')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws
      }

      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write override file')
      )
      expect(mockExit).toHaveBeenCalledWith(1)
      expect(runComposeSpy).not.toHaveBeenCalled()
    })

    test('writes override with correct parameters', async () => {
      const writeOverrideFileSpy = vi.spyOn(composeModule, 'writeOverrideFile')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws in our mock
      }

      expect(writeOverrideFileSpy).toHaveBeenCalledWith(
        mockWorktreeInfo.worktreePath,
        mockParsedCompose,
        mockWorktreeInfo.name,
        mockConfig.domain,
        'repo-feature-1'
      )
    })
  })

  describe('successful sync path', () => {
    test('executes docker compose after successful sync', async () => {
      const runComposeSpy = vi.spyOn(composeModule, 'runCompose')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws in our mock
      }

      expect(runComposeSpy).toHaveBeenCalledWith(
        mockWorktreeInfo.worktreePath,
        'docker-compose.yml',
        'repo-feature-1',
        ['ps'],
        {
          repoRoot: mockWorktreeInfo.repoRoot,
          branch: mockWorktreeInfo.name,
          domain: mockConfig.domain,
        }
      )
    })

    test('exits with docker compose exit code on success', async () => {
      vi.spyOn(composeModule, 'runCompose').mockResolvedValue({ exitCode: 0 } as any)

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws in our mock
      }

      expect(mockExit).toHaveBeenCalledWith(0)
    })

    test('exits with docker compose exit code on docker failure', async () => {
      vi.spyOn(composeModule, 'runCompose').mockResolvedValue({ exitCode: 1 } as any)

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected - process.exit throws in our mock
      }

      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  describe('fail-closed behavior regression', () => {
    test('does not execute docker when parse fails', async () => {
      vi.spyOn(composeModule, 'parseComposeFile').mockRejectedValue(new Error('Parse error'))
      const runComposeSpy = vi.spyOn(composeModule, 'runCompose')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['up', '-d'])
      } catch (error) {
        // Expected
      }

      expect(runComposeSpy).not.toHaveBeenCalled()
    })

    test('does not execute docker when write fails', async () => {
      vi.spyOn(composeModule, 'writeOverrideFile').mockRejectedValue(new Error('Write error'))
      const runComposeSpy = vi.spyOn(composeModule, 'runCompose')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['up', '-d'])
      } catch (error) {
        // Expected
      }

      expect(runComposeSpy).not.toHaveBeenCalled()
    })

    test('preserves existing behavior: missing compose file fails before sync', async () => {
      const parseComposeFileSpy = vi.spyOn(composeModule, 'parseComposeFile')
      const writeOverrideFileSpy = vi.spyOn(composeModule, 'writeOverrideFile')

      // Mock existsSync to return false for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected
      }

      expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Compose file not found'))
      expect(mockExit).toHaveBeenCalledWith(1)
      expect(parseComposeFileSpy).not.toHaveBeenCalled()
      expect(writeOverrideFileSpy).not.toHaveBeenCalled()
    })
  })

  describe('dc alias behavior', () => {
    test('dc alias uses same sync behavior', async () => {
      // This test documents that `dc` is just an alias
      // and uses the same compose() function, so all the
      // pre-sync behavior applies identically
      const parseComposeFileSpy = vi.spyOn(composeModule, 'parseComposeFile')
      const writeOverrideFileSpy = vi.spyOn(composeModule, 'writeOverrideFile')

      // Mock existsSync to return true for compose file
      const fs = await import('fs')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      try {
        await compose(['ps'])
      } catch (error) {
        // Expected
      }

      expect(parseComposeFileSpy).toHaveBeenCalled()
      expect(writeOverrideFileSpy).toHaveBeenCalled()
    })
  })
})

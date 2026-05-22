import { test, expect, describe, vi } from 'vitest'
import { getRunningWorktreeNames } from './worktreeStatus.ts'

describe('getRunningWorktreeNames', () => {
  const mockRepoRoot = '/test/repo'
  const mockDomain = 'port'
  const mockComposeFile = 'docker-compose.yml'

  test('returns empty array when no worktrees are running', async () => {
    const mockCollect = vi.fn().mockResolvedValue([
      {
        name: 'main',
        path: mockRepoRoot,
        services: [],
        running: false,
      },
      {
        name: 'feature-1',
        path: '/test/repo/.port/trees/feature-1',
        services: [],
        running: false,
      },
    ])

    const result = await getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain,
      mockCollect
    )
    expect(result).toEqual([])
  })

  test('returns names of running worktrees', async () => {
    const mockCollect = vi.fn().mockResolvedValue([
      {
        name: 'main',
        path: mockRepoRoot,
        services: [{ name: 'web', ports: [3000], running: true }],
        running: true,
      },
      {
        name: 'feature-1',
        path: '/test/repo/.port/trees/feature-1',
        services: [{ name: 'web', ports: [3000], running: false }],
        running: false,
      },
      {
        name: 'feature-2',
        path: '/test/repo/.port/trees/feature-2',
        services: [{ name: 'api', ports: [8080], running: true }],
        running: true,
      },
    ])

    const result = await getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain,
      mockCollect
    )
    expect(result).toEqual(['main', 'feature-2'])
  })

  test('returns empty array when collectWorktreeStatuses returns empty', async () => {
    const mockCollect = vi.fn().mockResolvedValue([])

    const result = await getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain,
      mockCollect
    )
    expect(result).toEqual([])
  })

  test('handles errors gracefully', async () => {
    const mockCollect = vi.fn().mockRejectedValue(new Error('Docker not running'))

    const result = await getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain,
      mockCollect
    )
    expect(result).toEqual([])
  })
})

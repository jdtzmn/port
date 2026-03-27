import { test, expect, describe, vi } from 'vitest'
import * as worktreeStatus from './worktreeStatus.ts'

describe('getRunningWorktreeNames', () => {
  const mockRepoRoot = '/test/repo'
  const mockDomain = 'port'
  const mockComposeFile = 'docker-compose.yml'

  test('returns empty array when no worktrees are running', async () => {
    // Spy on collectWorktreeStatuses to return no running worktrees
    const spy = vi.spyOn(worktreeStatus, 'collectWorktreeStatuses').mockResolvedValue([
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

    const result = await worktreeStatus.getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain
    )
    expect(result).toEqual([])

    spy.mockRestore()
  })

  test('returns names of running worktrees', async () => {
    // Spy on collectWorktreeStatuses to return mixed running/stopped
    const spy = vi.spyOn(worktreeStatus, 'collectWorktreeStatuses').mockResolvedValue([
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

    const result = await worktreeStatus.getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain
    )
    expect(result).toEqual(['main', 'feature-2'])

    spy.mockRestore()
  })

  test('returns empty array when collectWorktreeStatuses returns empty', async () => {
    const spy = vi.spyOn(worktreeStatus, 'collectWorktreeStatuses').mockResolvedValue([])

    const result = await worktreeStatus.getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain
    )
    expect(result).toEqual([])

    spy.mockRestore()
  })

  test('handles errors gracefully', async () => {
    const spy = vi
      .spyOn(worktreeStatus, 'collectWorktreeStatuses')
      .mockRejectedValue(new Error('Docker not running'))

    const result = await worktreeStatus.getRunningWorktreeNames(
      mockRepoRoot,
      mockComposeFile,
      mockDomain
    )
    expect(result).toEqual([])

    spy.mockRestore()
  })
})

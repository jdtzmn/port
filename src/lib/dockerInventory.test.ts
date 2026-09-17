import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
}))

vi.mock('./exec.ts', () => ({
  execFileAsync: mocks.execFileAsync,
}))

import { getRunningComposeServiceInventory } from './dockerInventory.ts'

describe('getRunningComposeServiceInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('groups running Compose services from one Docker query', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout:
        '{"project":"app-main","service":"api"}\n' +
        '{"project":"app-main","service":"worker"}\n' +
        '{"project":"app-feature","service":"api"}\n',
    })

    const inventory = await getRunningComposeServiceInventory()

    expect(inventory).toEqual(
      new Map([
        ['app-main', new Set(['api', 'worker'])],
        ['app-feature', new Set(['api'])],
      ])
    )
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(1)
    expect(mocks.execFileAsync).toHaveBeenCalledWith(
      'docker',
      [
        'ps',
        '--filter',
        'label=com.docker.compose.project',
        '--format',
        expect.stringContaining('com.docker.compose.service'),
      ],
      { encoding: 'utf8', timeout: 10_000 }
    )
  })

  test('ignores malformed and incomplete container rows', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout:
        'not json\n' + '{"project":"app-main"}\n' + '{"project":"app-main","service":"api"}\n',
    })

    await expect(getRunningComposeServiceInventory()).resolves.toEqual(
      new Map([['app-main', new Set(['api'])]])
    )
  })

  test('returns null when Docker is unavailable', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('docker unavailable'))

    await expect(getRunningComposeServiceInventory()).resolves.toBeNull()
  })
})

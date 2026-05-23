import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  traefikFilesExist: vi.fn(),
  initTraefikFiles: vi.fn(),
  ensure404HandlerImage: vi.fn(),
  ensureTraefikPorts: vi.fn(),
  isTraefikRunning: vi.fn(),
  startTraefik: vi.fn(),
  restartTraefik: vi.fn(),
  stopTraefik: vi.fn(),
  traefikHasRequiredPorts: vi.fn(),
}))

vi.mock('./traefik.ts', () => ({
  traefikFilesExist: mocks.traefikFilesExist,
  initTraefikFiles: mocks.initTraefikFiles,
  ensure404HandlerImage: mocks.ensure404HandlerImage,
  ensureTraefikPorts: mocks.ensureTraefikPorts,
}))

vi.mock('./compose.ts', () => ({
  isTraefikRunning: mocks.isTraefikRunning,
  startTraefik: mocks.startTraefik,
  restartTraefik: mocks.restartTraefik,
  stopTraefik: mocks.stopTraefik,
  traefikHasRequiredPorts: mocks.traefikHasRequiredPorts,
}))

import {
  prepareSharedStack,
  stopSharedStack,
  isSharedStackRunning,
  sharedStackHasRequiredPorts,
} from './shared-stack.ts'

describe('shared stack lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.traefikFilesExist.mockReturnValue(true)
    mocks.initTraefikFiles.mockResolvedValue(undefined)
    mocks.ensure404HandlerImage.mockResolvedValue(undefined)
    mocks.ensureTraefikPorts.mockResolvedValue(false)
    mocks.isTraefikRunning.mockResolvedValue(true)
    mocks.startTraefik.mockResolvedValue(undefined)
    mocks.restartTraefik.mockResolvedValue(undefined)
    mocks.stopTraefik.mockResolvedValue(undefined)
    mocks.traefikHasRequiredPorts.mockResolvedValue(true)
  })

  test('prepares the shared stack when Traefik is down', async () => {
    mocks.traefikFilesExist.mockReturnValue(false)
    mocks.isTraefikRunning.mockResolvedValue(false)
    mocks.ensureTraefikPorts.mockResolvedValue(true)

    const result = await prepareSharedStack([3000])

    expect(mocks.initTraefikFiles).toHaveBeenCalledWith([3000])
    expect(mocks.ensure404HandlerImage).toHaveBeenCalled()
    expect(mocks.ensureTraefikPorts).toHaveBeenCalledWith([3000])
    expect(mocks.startTraefik).toHaveBeenCalled()
    expect(mocks.restartTraefik).not.toHaveBeenCalled()
    expect(result).toEqual({ started: true, restarted: false, updated: true })
  })

  test('restarts the shared stack when configuration changed', async () => {
    mocks.ensureTraefikPorts.mockResolvedValue(true)

    const result = await prepareSharedStack([3000, 8080])

    expect(mocks.initTraefikFiles).not.toHaveBeenCalled()
    expect(mocks.ensure404HandlerImage).toHaveBeenCalled()
    expect(mocks.restartTraefik).toHaveBeenCalled()
    expect(mocks.startTraefik).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, restarted: true, updated: true })
  })

  test('stops the shared stack through the shared stop path', async () => {
    await stopSharedStack()

    expect(mocks.stopTraefik).toHaveBeenCalled()
  })

  test('proxies shared stack running status', async () => {
    mocks.isTraefikRunning.mockResolvedValue(true)

    await expect(isSharedStackRunning()).resolves.toBe(true)
  })

  test('proxies shared stack port checks', async () => {
    mocks.traefikHasRequiredPorts.mockResolvedValue(false)

    await expect(sharedStackHasRequiredPorts([3000])).resolves.toBe(false)
  })
})

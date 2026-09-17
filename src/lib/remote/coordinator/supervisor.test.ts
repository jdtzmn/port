import { describe, expect, it, vi } from 'vitest'
import { maintainRemoteRuntimeObservation, stopRemoteRuntimeObservation } from './supervisor.ts'
import type { RemoteCoordinatorRequest, RemoteCoordinatorResponse } from './control.ts'

const directory = '/tmp/port-ssh-Ab1234'
const paths = {
  root: '/private/root',
  controlRoot: '/private/control',
  dynamicDirectory: '/private/dynamic',
}

function response(
  incarnation: string,
  status: RemoteCoordinatorResponse['status'] = 'ok'
): RemoteCoordinatorResponse {
  return { version: 1, incarnation, status }
}

function operations(
  request: (
    root: string,
    value: RemoteCoordinatorRequest
  ) => Promise<RemoteCoordinatorResponse | null>,
  overrides: Record<string, unknown> = {}
) {
  return {
    enabled: vi.fn().mockResolvedValue(true),
    paths: vi.fn().mockResolvedValue(paths),
    request: vi.fn(request),
    launch: vi.fn(),
    endpointExists: vi.fn().mockResolvedValue(true),
    pause: vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => 0),
    ...overrides,
  }
}

describe('remote observation watchdog', () => {
  it('does nothing when remote runtime is disabled', async () => {
    const request = vi.fn()
    const control = new AbortController()
    const actions = operations(request, { enabled: vi.fn().mockResolvedValue(false) })

    await maintainRemoteRuntimeObservation(directory, control.signal, actions)

    expect(actions.paths).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(actions.launch).not.toHaveBeenCalled()
  })

  it('launches a missing coordinator and refreshes admission while it remains live', async () => {
    const control = new AbortController()
    const pings = [
      null,
      response('a'.repeat(32)),
      response('a'.repeat(32)),
      response('b'.repeat(32)),
    ]
    const request = vi.fn(async (_root: string, value: RemoteCoordinatorRequest) => {
      if (value.action === 'ping') {
        const next = pings.shift()
        return next === undefined ? response('b'.repeat(32)) : next
      }
      return response(value.incarnation)
    })
    let pauses = 0
    const actions = operations(request, {
      pause: vi.fn(async () => {
        pauses++
        if (pauses === 4) control.abort()
      }),
    })

    await maintainRemoteRuntimeObservation(directory, control.signal, actions)

    expect(actions.launch).toHaveBeenCalledOnce()
    expect(request.mock.calls.map(([, value]) => value.action)).toEqual([
      'ping',
      'ping',
      'observe',
      'ping',
      'observe',
      'ping',
      'observe',
    ])
    const admissions = request.mock.calls
      .map(([, value]) => value)
      .filter(value => value.action === 'observe')
    expect(admissions).toEqual([
      { version: 1, action: 'observe', incarnation: 'a'.repeat(32), directory },
      { version: 1, action: 'observe', incarnation: 'a'.repeat(32), directory },
      { version: 1, action: 'observe', incarnation: 'b'.repeat(32), directory },
    ])
  })

  it('retries rejected admission at the fast interval', async () => {
    const control = new AbortController()
    let admissions = 0
    const request = vi.fn(async (_root: string, value: RemoteCoordinatorRequest) => {
      if (value.action === 'ping') return response('a'.repeat(32))
      admissions++
      return response('a'.repeat(32), admissions === 1 ? 'error' : 'ok')
    })
    const actions = operations(request, {
      pause: vi.fn(async () => {
        if (admissions === 2) control.abort()
      }),
    })

    await maintainRemoteRuntimeObservation(directory, control.signal, actions)

    expect(admissions).toBe(2)
    expect(actions.pause.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([250, 2000])
    expect(actions.launch).not.toHaveBeenCalled()
  })

  it('treats a definitively absent coordinator as already unobserved', async () => {
    const request = vi.fn().mockResolvedValue(null)
    const actions = operations(request, {
      endpointExists: vi.fn().mockResolvedValue(false),
    })

    await expect(stopRemoteRuntimeObservation(directory, actions)).resolves.toBe(true)
    expect(actions.launch).not.toHaveBeenCalled()
    expect(actions.pause).not.toHaveBeenCalled()
  })

  it('retries unobserve timeouts and incarnation changes until acknowledged', async () => {
    const incarnations = ['a'.repeat(32), 'b'.repeat(32)]
    let unobserves = 0
    const request = vi.fn(async (_root: string, value: RemoteCoordinatorRequest) => {
      if (value.action === 'ping') return response(incarnations[Math.min(unobserves, 1)]!)
      unobserves++
      return unobserves === 1 ? null : response(value.incarnation)
    })
    const actions = operations(request)

    await expect(stopRemoteRuntimeObservation(directory, actions)).resolves.toBe(true)
    expect(unobserves).toBe(2)
    expect(actions.pause).toHaveBeenCalledOnce()
    expect(actions.launch).not.toHaveBeenCalled()
  })

  it('fails closed after a bounded ambiguous live coordinator failure', async () => {
    let now = 0
    const request = vi.fn().mockResolvedValue(null)
    const actions = operations(request, {
      now: vi.fn(() => now),
      pause: vi.fn(async () => {
        now = 10_000
      }),
    })

    await expect(stopRemoteRuntimeObservation(directory, actions)).resolves.toBe(false)
    expect(actions.endpointExists).toHaveBeenCalledWith(paths.controlRoot)
    expect(actions.launch).not.toHaveBeenCalled()
  })
})

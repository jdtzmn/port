import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectDoctorReport: vi.fn(),
  assertDoctorHealthy: vi.fn(),
  header: vi.fn(),
  newline: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../lib/doctor.ts', () => ({
  collectDoctorReport: mocks.collectDoctorReport,
  assertDoctorHealthy: mocks.assertDoctorHealthy,
}))
vi.mock('../lib/output.ts', () => ({
  header: mocks.header,
  newline: mocks.newline,
  success: mocks.success,
}))

import { doctor } from './doctor.ts'

const report = {
  context: { repoRoot: '/repo', worktree: 'feature', domain: 'port', projectDetected: true },
  checks: [
    { id: 'docker', category: 'prerequisites', status: 'pass', summary: 'Docker is running.' },
    { id: 'traefik', category: 'routing', status: 'pass', summary: 'Traefik is running.' },
    {
      id: 'stale-worktrees',
      category: 'state',
      status: 'warn',
      summary: '13 stale worktrees found.',
      remediation: 'Review them with `port prune --dry-run`.',
    },
    {
      id: 'dns',
      category: 'domains',
      status: 'fail',
      summary: '*.port does not resolve locally.',
      remediation: 'Run `port install --domain port`, then retry.',
    },
  ],
} as const

describe('doctor command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.collectDoctorReport.mockResolvedValue(report)
  })

  test('keeps default output concise', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await doctor()

    const lines = errorSpy.mock.calls.map(call => String(call[0])).join('\n')
    expect(lines).toContain('Docker is running.')
    expect(mocks.header).toHaveBeenCalledWith('Needs attention')
    expect(lines).toContain('13 stale worktrees found.')
    expect(mocks.header).toHaveBeenCalledWith('Blockers')
    expect(lines).toContain('*.port does not resolve locally.')
    expect(mocks.header).not.toHaveBeenCalledWith('Routing')
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.assertDoctorHealthy).toHaveBeenCalledWith(report)
    errorSpy.mockRestore()
  })

  test('shows every category with --verbose', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await doctor({ verbose: true })

    const lines = errorSpy.mock.calls.map(call => String(call[0])).join('\n')
    expect(mocks.header).toHaveBeenCalledWith('Routing')
    expect(lines).toContain('Traefik is running.')
    expect(mocks.header).toHaveBeenCalledWith('Local domains')
    expect(mocks.header).toHaveBeenCalledWith('State')
    errorSpy.mockRestore()
  })

  test('prints a green success message when no checks need attention', async () => {
    mocks.collectDoctorReport.mockResolvedValue({
      context: report.context,
      checks: [
        { id: 'docker', category: 'prerequisites', status: 'pass', summary: 'Docker is running.' },
      ],
    })

    await doctor()

    expect(mocks.success).toHaveBeenCalledWith('Port is ready.')
  })

  test('suggests initialization outside a Port project', async () => {
    mocks.collectDoctorReport.mockResolvedValue({
      context: { ...report.context, projectDetected: false },
      checks: [
        { id: 'docker', category: 'prerequisites', status: 'pass', summary: 'Docker is running.' },
      ],
    })

    await doctor()

    expect(mocks.success).toHaveBeenCalledWith(
      'Port prerequisites are ready. Run `port init` to initialize this repository.'
    )
  })
})

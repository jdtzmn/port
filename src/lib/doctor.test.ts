import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFile: vi.fn(),
  configExists: vi.fn(),
  loadConfig: vi.fn(),
  getComposeFile: vi.fn(),
  isTraefikRunning: vi.fn(),
  checkDns: vi.fn(),
  execAsync: vi.fn(),
  isProcessRunning: vi.fn(),
  getStaleWorktreeCandidates: vi.fn(),
  loadTraefikConfig: vi.fn(),
  traefikFilesExist: vi.fn(),
  detectWorktree: vi.fn(),
}))

vi.mock('fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('fs/promises', () => ({ readFile: mocks.readFile }))
vi.mock('./config.ts', () => ({
  configExists: mocks.configExists,
  loadConfig: mocks.loadConfig,
  getComposeFile: mocks.getComposeFile,
}))
vi.mock('./compose.ts', () => ({ isTraefikRunning: mocks.isTraefikRunning }))
vi.mock('./dns.ts', () => ({ checkDns: mocks.checkDns }))
vi.mock('./exec.ts', () => ({ execAsync: mocks.execAsync }))
vi.mock('./hostService.ts', () => ({ isProcessRunning: mocks.isProcessRunning }))
vi.mock('./staleWorktrees.ts', () => ({
  getStaleWorktreeCandidates: mocks.getStaleWorktreeCandidates,
  STALE_WORKTREE_WARNING_THRESHOLD: 10,
}))
vi.mock('./traefik.ts', () => ({
  loadTraefikConfig: mocks.loadTraefikConfig,
  traefikFilesExist: mocks.traefikFilesExist,
}))
vi.mock('./worktree.ts', () => ({ detectWorktree: mocks.detectWorktree }))

import { collectDoctorReport } from './doctor.ts'

describe('collectDoctorReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectWorktree.mockReturnValue({ repoRoot: '/repo', name: 'feature' })
    mocks.configExists.mockReturnValue(true)
    mocks.loadConfig.mockResolvedValue({ domain: 'port', compose: 'docker-compose.yml' })
    mocks.getComposeFile.mockReturnValue('docker-compose.yml')
    mocks.existsSync.mockReturnValue(true)
    mocks.readFile.mockResolvedValue(JSON.stringify({ projects: [], hostServices: [] }))
    mocks.checkDns.mockResolvedValue(true)
    mocks.execAsync.mockImplementation(async (command: string) => ({
      stdout: command.includes('compose version') ? 'v2.24.6\n' : '',
      stderr: '',
    }))
    mocks.isProcessRunning.mockReturnValue(true)
    mocks.getStaleWorktreeCandidates.mockResolvedValue([])
    mocks.isTraefikRunning.mockResolvedValue(false)
    mocks.traefikFilesExist.mockReturnValue(false)
    mocks.loadTraefikConfig.mockResolvedValue(null)
  })

  test('collects passing prerequisite and project checks', async () => {
    const report = await collectDoctorReport()

    expect(report.context).toMatchObject({ repoRoot: '/repo', worktree: 'feature', domain: 'port' })
    expect(report.checks.find(result => result.id === 'docker')).toMatchObject({ status: 'pass' })
    expect(report.checks.find(result => result.id === 'compose')).toMatchObject({ status: 'pass' })
    expect(report.checks.find(result => result.id === 'dns')).toMatchObject({ status: 'pass' })
    expect(report.checks.some(result => result.status === 'fail')).toBe(false)
  })

  test('reports unavailable Compose without short-circuiting other checks', async () => {
    mocks.execAsync.mockImplementation(async (command: string) => {
      if (command.includes('compose version')) throw new Error('missing')
      return { stdout: '', stderr: '' }
    })

    const report = await collectDoctorReport()

    expect(report.checks.find(result => result.id === 'compose')).toMatchObject({ status: 'fail' })
    expect(report.checks.find(result => result.id === 'dns')).toMatchObject({ status: 'pass' })
  })

  test('reports malformed global registry as a blocker', async () => {
    mocks.readFile.mockResolvedValue('{ not json')

    const report = await collectDoctorReport()

    expect(report.checks.find(result => result.id === 'registry')).toMatchObject({ status: 'fail' })
  })

  test('reports dead host services without cleaning them up', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        projects: [],
        hostServices: [
          {
            repo: '/repo',
            branch: 'feature',
            logicalPort: 3000,
            actualPort: 49152,
            pid: 42,
            configFile: '/tmp/service.yml',
          },
        ],
      })
    )
    mocks.isProcessRunning.mockReturnValue(false)

    const report = await collectDoctorReport()

    expect(report.checks.find(result => result.id === 'host-services')).toMatchObject({
      status: 'warn',
    })
  })

  test('is useful outside Port projects', async () => {
    mocks.configExists.mockReturnValue(false)

    const report = await collectDoctorReport()

    expect(report.context.projectDetected).toBe(false)
    expect(report.checks.find(result => result.id === 'project')).toMatchObject({ status: 'info' })
  })
})

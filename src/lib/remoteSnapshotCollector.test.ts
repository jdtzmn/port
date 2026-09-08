import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostService, Registry } from '../types.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ open: vi.fn() }))
vi.mock('./registry.ts', () => ({ REGISTRY_FILE: '/registry.json' }))
vi.mock('./config.ts', () => ({ loadConfigOrDefault: vi.fn() }))
vi.mock('./hostService.ts', () => ({ isProcessRunning: vi.fn() }))

import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

// Fixture provider only; production never calls the permissive registry loader.
const loadRegistry = vi.fn<() => Promise<Registry>>()
function registryFile(
  content: string | Buffer,
  chunkSize = Infinity,
  declaredSize?: number,
  regular = true,
  install = true
) {
  const bytes = Buffer.from(content)
  let position = 0
  const file = {
    stat: vi.fn(async () => ({ size: declaredSize ?? bytes.length, isFile: () => regular })),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number) => {
      const count = Math.min(length, chunkSize, bytes.length - position)
      bytes.copy(buffer, offset, position, position + count)
      position += count
      return { bytesRead: count, buffer }
    }),
    close: vi.fn(async () => {}),
  }
  if (install)
    vi.mocked(open).mockResolvedValue(file as unknown as Awaited<ReturnType<typeof open>>)
  return file
}
import { loadConfigOrDefault } from './config.ts'
import { isProcessRunning } from './hostService.ts'
import { collectRemoteSnapshot } from './remoteSnapshotCollector.ts'

const id = 'a'.repeat(64)
const project = { repo: '/repos/app', branch: 'main', ports: [] }
const host: HostService = {
  ...project,
  pid: 123,
  logicalPort: 3000,
  actualPort: 50000,
  command: 'secret command',
  configFile: '/secret/path',
}
const container = () => ({
  id,
  stateRunning: true,
  labels: {
    'com.docker.compose.project': 'app-main',
    'com.docker.compose.service': 'web',
    'com.docker.compose.project.working_dir': '/untrusted/secret',
    'traefik.enable': 'true',
    'traefik.http.routers.main-web-3000.entrypoints': 'port3000',
    'traefik.http.routers.main-web-3000.service': 'main-web-3000',
    'traefik.http.routers.main-web-3000.rule': 'Host(`main.custom.test`)',
    'traefik.http.services.main-web-3000.loadbalancer.server.port': '8080',
  },
  networks: { 'traefik-network': { IPAddress: '172.20.0.2' }, '': { IPAddress: '' } },
})
const json = (value: unknown) => JSON.stringify(value) + '\n'
function replies(...values: (string | Error)[]) {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    const value = values.shift()
    if (value === undefined) throw new Error('Unexpected Docker call')
    callback(
      value instanceof Error ? value : null,
      typeof value === 'string' ? value : '',
      'secret stderr'
    )
  }) as typeof execFile)
}
const rejects = () =>
  expect(collectRemoteSnapshot('machine', 2)).rejects.toThrow(/^Unable to collect remote snapshot$/)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(loadRegistry).mockResolvedValue({ projects: [project], hostServices: [] })
  vi.mocked(open).mockImplementation(async () => {
    const file = registryFile(
      JSON.stringify(await loadRegistry()),
      Infinity,
      undefined,
      true,
      false
    )
    return file as unknown as Awaited<ReturnType<typeof open>>
  })
  vi.mocked(loadConfigOrDefault).mockResolvedValue({
    domain: 'custom.test',
    compose: 'compose.yml',
  })
  vi.mocked(isProcessRunning).mockReturnValue(true)
})

describe('collectRemoteSnapshot', () => {
  it('reads valid registry through partial reads and always closes', async () => {
    const file = registryFile(json({ projects: [], hostServices: [host] }), 7)
    expect((await collectRemoteSnapshot('machine', 0)).worktrees).toHaveLength(1)
    expect(open).toHaveBeenCalledWith(
      '/registry.json',
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    expect(file.read.mock.calls.length).toBeGreaterThan(2)
    expect(file.close).toHaveBeenCalledTimes(1)
  })
  it.each(['EACCES', 'EPERM', 'ELOOP'])('rejects permissions and symlinks (%s)', async code => {
    vi.mocked(open).mockRejectedValue(Object.assign(new Error('/secret/path'), { code }))
    await rejects()
    expect(execFile).not.toHaveBeenCalled()
  })
  it.each([
    '',
    '{',
    'null',
    '[]',
    '{}',
    '{"projects":[],"hostServices":null}',
    '{"projects":[{"repo":"","branch":"main","ports":[]}]}',
    '{"projects":[],"hostServices":[{}]}',
  ])('rejects malformed or invalid schema without exposing contents', async content => {
    const file = registryFile(content)
    await rejects()
    expect(file.close).toHaveBeenCalledTimes(1)
    expect(execFile).not.toHaveBeenCalled()
  })
  it.each([
    'oversize',
    'growth',
    'nonregular',
    'read',
    'stat',
    'close',
    'utf8',
    'longRepo',
    'badPort',
  ])('fails closed for %s', async mode => {
    const content =
      mode === 'growth'
        ? ' '.repeat(4194305)
        : mode === 'utf8'
          ? Buffer.from([0xff])
          : mode === 'longRepo'
            ? json({ projects: [{ ...project, repo: 'x'.repeat(4097) }] })
            : mode === 'badPort'
              ? json({ projects: [], hostServices: [{ ...host, actualPort: 0 }] })
              : json({ projects: [] })
    const file = registryFile(
      content,
      65536,
      mode === 'oversize' ? 4194305 : 0,
      mode !== 'nonregular'
    )
    if (mode === 'read') file.read.mockRejectedValue(new Error('/secret'))
    if (mode === 'stat') file.stat.mockRejectedValue(new Error('/secret'))
    if (mode === 'close') file.close.mockRejectedValue(new Error('/secret'))
    await rejects()
    expect(file.close).toHaveBeenCalledTimes(1)
    expect(execFile).not.toHaveBeenCalled()
    if (mode === 'oversize' || mode === 'nonregular') expect(file.read).not.toHaveBeenCalled()
    if (mode === 'growth')
      expect(file.read.mock.calls.every(([buffer]) => buffer.length === 4194305)).toBe(true)
  })
  it('enforces the shared Docker deadline', async () => {
    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10001)
    replies(id + '\n')
    try {
      await rejects()
      expect(execFile).toHaveBeenCalledTimes(1)
    } finally {
      clock.mockRestore()
    }
  })
  it.each(['labels', 'networks'])('rejects excessive %s', async field => {
    const value = container()
    if (field === 'labels')
      Object.assign(
        value.labels,
        Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`key${i}`, 'value']))
      )
    else
      Object.assign(
        value.networks,
        Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`net${i}`, { IPAddress: '' }]))
      )
    replies(id + '\n', json(value))
    await rejects()
  })
  it('maps authoritative context and domain, selecting only safe Docker fields', async () => {
    replies(id + '\n', json(container()))
    const snapshot = await collectRemoteSnapshot('machine', 2)
    expect(snapshot.revision).toBe(2)
    expect(snapshot.worktrees[0]?.namespace).toBe('main.custom.test')
    expect(snapshot.worktrees[0]?.endpoints[0]?.target).toEqual({
      address: '172.20.0.2',
      port: 8080,
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|working_dir|labels|repos/)
    expect(loadConfigOrDefault).toHaveBeenCalledWith('/repos/app')
    const calls = vi.mocked(execFile).mock.calls
    expect(calls[0]?.[1]).toEqual([
      'ps',
      '--no-trunc',
      '--quiet',
      '--filter',
      'label=traefik.enable=true',
      '--filter',
      'label=com.docker.compose.project=app-main',
    ])
    const args = calls[1]?.[1] as string[]
    expect(args[4]).toContain('.Config.Labels')
    expect(args[4]).toContain('$n.IPAddress')
    expect(JSON.stringify(calls)).not.toMatch(/\.Env|compose.*config/)
    for (const call of calls) {
      expect(call[0]).toBe('docker')
      expect(call[2]).toMatchObject({ shell: false, maxBuffer: 4194304, killSignal: 'SIGKILL' })
      expect((call[2] as { timeout: number }).timeout).toBeLessThanOrEqual(10000)
    }
  })
  it('rejects basename collisions before config or Docker work', async () => {
    vi.mocked(loadRegistry).mockResolvedValue({
      projects: [project, { ...project, repo: '/elsewhere/app' }],
    })
    await rejects()
    expect(execFile).not.toHaveBeenCalled()
    expect(loadConfigOrDefault).not.toHaveBeenCalled()
  })
  it('skips Docker only with no registered projects and projects selected host fields', async () => {
    vi.mocked(loadRegistry).mockResolvedValue({ projects: [], hostServices: [host] })
    const snapshot = await collectRemoteSnapshot('machine', 2)
    expect(snapshot.worktrees[0]?.endpoints[0]?.target.port).toBe(50000)
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|command|configFile/)
    expect(isProcessRunning).toHaveBeenCalledWith(123)
    expect(execFile).not.toHaveBeenCalled()
  })
  it('omits stopped hosts and containers', async () => {
    vi.mocked(loadRegistry).mockResolvedValue({ projects: [project], hostServices: [host] })
    vi.mocked(isProcessRunning).mockReturnValue(false)
    replies(id + '\n', json({ ...container(), stateRunning: false }))
    expect((await collectRemoteSnapshot('machine', 2)).worktrees).toEqual([])
  })
  it('treats only absent registry as empty without writes', async () => {
    vi.mocked(open).mockRejectedValue(Object.assign(new Error('secret'), { code: 'ENOENT' }))
    expect((await collectRemoteSnapshot('machine', 0)).worktrees).toEqual([])
    expect(loadRegistry).not.toHaveBeenCalled()
    expect(execFile).not.toHaveBeenCalled()
  })
  it.each(['registry', 'config', 'process', 'docker'])('sanitizes %s failure', async source => {
    const error = new Error('/secret/path password=hidden')
    vi.mocked(loadRegistry).mockResolvedValue({ projects: [project], hostServices: [host] })
    if (source === 'registry') vi.mocked(loadRegistry).mockRejectedValue(error)
    if (source === 'config') vi.mocked(loadConfigOrDefault).mockRejectedValue(error)
    if (source === 'process')
      vi.mocked(isProcessRunning).mockImplementation(() => {
        throw error
      })
    replies(error)
    await rejects()
  })
  it.each(['short\n', id, id + '\n' + id + '\n', '\n'])(
    'rejects invalid ps output %j',
    async output => {
      replies(output)
      await rejects()
    }
  )
  it.each([
    '',
    '{\n',
    JSON.stringify(container()),
    json([]),
    json({ ...container(), id: 'b'.repeat(64) }),
  ])('rejects incomplete or invalid inspect output', async output => {
    replies(id + '\n', output)
    await rejects()
  })
  it('rejects inspect failure instead of returning empty state', async () => {
    replies(id + '\n', new Error('timeout secret'))
    await rejects()
  })
  it('rejects unknown compose membership even with plausible working dir', async () => {
    const value = container()
    value.labels['com.docker.compose.project'] = 'other-main'
    replies(id + '\n', json(value))
    await rejects()
  })
  it('bounds registry and Docker counts', async () => {
    vi.mocked(loadRegistry).mockResolvedValue({ projects: Array(1025).fill(project) })
    await rejects()
    expect(execFile).not.toHaveBeenCalled()
    vi.mocked(loadRegistry).mockResolvedValue({ projects: [project] })
    replies(
      Array.from({ length: 1025 }, (_, i) => i.toString(16).padStart(64, '0')).join('\n') + '\n'
    )
    await rejects()
    expect(execFile).toHaveBeenCalledTimes(1)
  })
  it('bounds output bytes', async () => {
    replies('x'.repeat(4194305))
    await rejects()
  })
  it('bounds config read concurrency to four', async () => {
    const projects = Array.from({ length: 12 }, (_, i) => ({ ...project, repo: `/repo${i}` }))
    vi.mocked(loadRegistry).mockResolvedValue({ projects })
    let active = 0
    let peak = 0
    vi.mocked(loadConfigOrDefault).mockImplementation(async () => {
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return { domain: 'custom.test', compose: 'compose.yml' }
    })
    replies(...projects.map(() => ''))
    await collectRemoteSnapshot('machine', 0)
    expect(peak).toBe(4)
  })
  it('batches inspect to at most 32 IDs', async () => {
    const ids = Array.from({ length: 33 }, (_, i) => i.toString(16).padStart(64, '0'))
    replies(
      ids.join('\n') + '\n',
      ids
        .slice(0, 32)
        .map(id => json({ ...container(), id }))
        .join(''),
      json({ ...container(), id: ids[32] })
    )
    await collectRemoteSnapshot('machine', 0)
    expect((vi.mocked(execFile).mock.calls[1]?.[1] as string[]).length).toBe(37)
    expect((vi.mocked(execFile).mock.calls[2]?.[1] as string[]).length).toBe(6)
  })
})

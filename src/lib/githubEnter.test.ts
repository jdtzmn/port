import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveGithubEnterUrl, preparePullRequest } from './githubEnter.ts'

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  branchExists: vi.fn(),
  isValidBranchRef: vi.fn(),
  getGit: vi.fn(),
  raw: vi.fn(),
  getConfig: vi.fn(),
}))
vi.mock('./exec.ts', () => ({ execFileAsync: mocks.execFileAsync }))
vi.mock('./git.ts', () => ({
  branchExists: mocks.branchExists,
  isValidBranchRef: mocks.isValidBranchRef,
  getGit: mocks.getGit,
}))

const oid = 'a'.repeat(40)
const issueUrl = 'https://github.com/acme/app/issues/42'
const prUrl = 'https://github.com/acme/app/pull/57'

function reply(value: unknown): { stdout: string } {
  return { stdout: typeof value === 'string' ? value : JSON.stringify(value) }
}

function pr(fork = false) {
  return {
    number: 57,
    headRefName: 'feature/auth',
    headRefOid: oid,
    isCrossRepository: fork,
    state: 'OPEN',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getGit.mockReturnValue({ raw: mocks.raw, getConfig: mocks.getConfig })
  mocks.isValidBranchRef.mockResolvedValue(true)
  mocks.branchExists.mockResolvedValue(false)
  mocks.getConfig.mockResolvedValue({ value: null })
  mocks.raw.mockImplementation(async (args: string[]) => {
    if (args[0] === 'rev-parse') return `${oid}\n`
    return ''
  })
  mocks.execFileAsync.mockImplementation(async (program: string, args: string[]) => {
    if (program === 'git') return reply('git@github.com:acme/app.git')
    if (args[0] === 'api' && args[3] === 'repos/acme/app') {
      return reply({ node_id: 'repo-id', full_name: 'acme/app' })
    }
    if (args[0] === 'api' && args[3] === 'user') return reply({ login: 'Jdtzmn' })
    if (args[0] === 'issue') return reply({ number: 42 })
    if (args[0] === 'pr') return reply(pr())
    throw new Error(`Unexpected command: ${program} ${args.join(' ')}`)
  })
})

describe('GitHub URL resolution', () => {
  test('validates the issue and uses the authenticated GitHub login', async () => {
    const result = await resolveGithubEnterUrl('/repo', issueUrl)
    expect(result.branch).toBe('jdtzmn/issue-42')
    expect(mocks.execFileAsync).toHaveBeenCalledWith(
      'gh',
      ['issue', 'view', '42', '-R', 'acme/app', '--json', 'number'],
      expect.objectContaining({ cwd: '/repo' })
    )
  })

  test('resolves a PR head and fork metadata', async () => {
    mocks.execFileAsync.mockImplementation(async (program: string, args: string[]) => {
      if (program === 'git') return reply('https://github.com/acme/app.git')
      if (args[0] === 'api') return reply({ node_id: 'repo-id', full_name: 'acme/app' })
      return reply(pr(true))
    })
    expect((await resolveGithubEnterUrl('/repo', prUrl)).pr).toEqual({
      headOid: oid,
      fork: true,
      state: 'OPEN',
    })
  })

  test('rejects a different origin before looking up the issue', async () => {
    mocks.execFileAsync.mockImplementation(async (program: string, args: string[]) => {
      if (program === 'git') return reply('git@github.com:other/app.git')
      if (args[0] === 'api' && args[3] === 'repos/other/app')
        return reply({ node_id: 'other-id', full_name: 'other/app' })
      return reply({ node_id: 'repo-id', full_name: 'acme/app' })
    })
    await expect(resolveGithubEnterUrl('/repo', issueUrl)).rejects.toThrow('origin is other/app')
    expect(mocks.execFileAsync.mock.calls.some(([, args]) => args[0] === 'issue')).toBe(false)
  })

  test('does not interpret a missing issue as a branch', async () => {
    mocks.execFileAsync.mockImplementation(async (program: string, args: string[]) => {
      if (program === 'git') return reply('git@github.com:acme/app.git')
      if (args[0] === 'issue') throw new Error('not found')
      return reply({ node_id: 'repo-id', full_name: 'acme/app' })
    })
    await expect(resolveGithubEnterUrl('/repo', issueUrl)).rejects.toThrow('could not access')
  })
})

describe('PR branch preparation', () => {
  const resolved = {
    branch: 'feature/auth',
    url: { kind: 'github-pr' as const, owner: 'acme', repo: 'app', number: 57 },
    canonicalRepo: 'acme/app',
    pr: { headOid: oid, fork: true, state: 'OPEN' },
  }

  test('fetches the numbered PR ref and creates its branch with provenance', async () => {
    await preparePullRequest('/repo', resolved)
    expect(mocks.raw.mock.calls.map(([args]) => args)).toEqual([
      ['fetch', 'origin', 'refs/pull/57/head'],
      ['rev-parse', 'FETCH_HEAD'],
      ['branch', 'feature/auth', oid],
      ['config', '--local', 'branch.feature/auth.port-pr', 'acme/app#57'],
    ])
  })

  test('reuses an associated fork branch but rejects an unrelated branch', async () => {
    mocks.branchExists.mockResolvedValue(true)
    await expect(preparePullRequest('/repo', resolved)).rejects.toThrow('may belong to another PR')
    expect(mocks.raw).not.toHaveBeenCalled()
    mocks.getConfig.mockResolvedValue({ value: 'acme/app#57' })
    await preparePullRequest('/repo', resolved)
    expect(mocks.raw).not.toHaveBeenCalled()
  })

  test('allows an existing same-repo head only when origin matches the PR', async () => {
    mocks.branchExists.mockResolvedValue(true)
    mocks.raw.mockResolvedValue(`${oid}\trefs/heads/feature/auth\n`)
    await preparePullRequest('/repo', { ...resolved, pr: { ...resolved.pr, fork: false } })
    expect(mocks.raw).toHaveBeenCalledWith(['ls-remote', '--heads', 'origin', 'feature/auth'])
  })

  test('refuses to create a branch from HEAD for closed or changed PRs', async () => {
    await expect(
      preparePullRequest('/repo', { ...resolved, pr: { ...resolved.pr, state: 'MERGED' } })
    ).rejects.toThrow('not available locally')
    expect(mocks.raw).not.toHaveBeenCalled()
    mocks.raw.mockImplementation(async (args: string[]) =>
      args[0] === 'rev-parse' ? 'b'.repeat(40) : ''
    )
    await expect(preparePullRequest('/repo', resolved)).rejects.toThrow('head changed')
    expect(mocks.raw.mock.calls.some(([args]) => args[0] === 'branch')).toBe(false)
  })
})

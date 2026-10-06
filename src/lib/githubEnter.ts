import { execFileAsync } from './exec.ts'
import { parseEnterUrl, type EnterUrl } from './enterUrl.ts'
import { branchExists, getGit, isValidBranchRef } from './git.ts'

export interface ResolvedEnterUrl {
  branch: string
  url: EnterUrl
  canonicalRepo: string
  pr?: { headOid: string; fork: boolean; state: string }
}

async function command(program: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(program, args, { cwd, timeout: 15000 })
    return stdout.trim()
  } catch (error) {
    const reason =
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? `${program} is not installed`
        : `${program} could not access the requested GitHub repository (check authentication, access and network)`
    throw new Error(reason, { cause: error })
  }
}

function json(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    /* invalid response */
  }
  throw new Error('GitHub returned an invalid response')
}

function originRepo(remote: string): string | null {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-z\d-]+)\/([a-z\d_.-]+?)(?:\.git)?\/?$/i.exec(
      remote
    )
  return match ? `${match[1]}/${match[2]}` : null
}

async function repository(repoRoot: string, name: string): Promise<{ id: string; name: string }> {
  const data = json(
    await command('gh', ['api', '--hostname', 'github.com', `repos/${name}`], repoRoot)
  )
  if (typeof data.node_id !== 'string' || typeof data.full_name !== 'string') {
    throw new Error('GitHub returned incomplete repository metadata')
  }
  return { id: data.node_id, name: data.full_name }
}

export async function resolveGithubEnterUrl(
  repoRoot: string,
  input: string
): Promise<ResolvedEnterUrl> {
  const url = parseEnterUrl(input)
  if (!url) throw new Error('Expected a GitHub issue or pull request URL')
  const target = await repository(repoRoot, `${url.owner}/${url.repo}`)
  const remote = originRepo(await command('git', ['remote', 'get-url', 'origin'], repoRoot))
  if (!remote) throw new Error('The origin remote must point to a github.com repository')
  const local =
    remote.toLowerCase() === target.name.toLowerCase() ? target : await repository(repoRoot, remote)
  if (target.id !== local.id) {
    throw new Error(`URL is for ${target.name}, but origin is ${local.name}`)
  }

  if (url.kind === 'github-issue') {
    const issue = json(
      await command(
        'gh',
        ['issue', 'view', String(url.number), '-R', target.name, '--json', 'number'],
        repoRoot
      )
    )
    if (issue.number !== url.number) throw new Error('GitHub returned the wrong issue')
    const user = json(await command('gh', ['api', '--hostname', 'github.com', 'user'], repoRoot))
    if (typeof user.login !== 'string' || !/^[a-z\d-]+$/i.test(user.login)) {
      throw new Error('GitHub did not return a valid authenticated login')
    }
    return {
      branch: `${user.login.toLowerCase()}/issue-${url.number}`,
      url,
      canonicalRepo: target.name,
    }
  }

  const pr = json(
    await command(
      'gh',
      [
        'pr',
        'view',
        String(url.number),
        '-R',
        target.name,
        '--json',
        'number,headRefName,headRefOid,isCrossRepository,state',
      ],
      repoRoot
    )
  )
  if (
    pr.number !== url.number ||
    typeof pr.headRefName !== 'string' ||
    !pr.headRefName ||
    typeof pr.headRefOid !== 'string' ||
    !/^[a-f\d]{40}$/i.test(pr.headRefOid) ||
    typeof pr.isCrossRepository !== 'boolean' ||
    typeof pr.state !== 'string'
  )
    throw new Error('GitHub returned incomplete pull request metadata')
  return {
    branch: pr.headRefName,
    url,
    canonicalRepo: target.name,
    pr: { headOid: pr.headRefOid, fork: pr.isCrossRepository, state: pr.state },
  }
}

/** Prepare a PR head as a local branch without ever falling back to current HEAD. */
export async function preparePullRequest(
  repoRoot: string,
  resolved: ResolvedEnterUrl
): Promise<void> {
  if (!resolved.pr) return
  const { branch, pr, url, canonicalRepo } = resolved
  const git = getGit(repoRoot)
  if (!(await isValidBranchRef(repoRoot, branch))) {
    throw new Error(`PR head is not a valid Git branch: ${branch}`)
  }
  const key = `branch.${branch}.port-pr`
  const identity = `${canonicalRepo.toLowerCase()}#${url.number}`
  const exists = await branchExists(repoRoot, branch)
  if (exists) {
    // A matching name alone is not evidence that a fork's branch is this PR.
    const config = await git.getConfig(key)
    if (config.value === identity) return
    if (config.value || pr.fork || pr.state !== 'OPEN') {
      throw new Error(`Branch ${branch} may belong to another PR; enter it by branch name instead`)
    }
    const remoteHead = await git.raw(['ls-remote', '--heads', 'origin', branch])
    if (remoteHead.split(/\s+/)[0]?.toLowerCase() !== pr.headOid.toLowerCase()) {
      throw new Error(`Branch ${branch} does not match the PR head on origin`)
    }
    return
  }
  if (pr.state !== 'OPEN') {
    throw new Error(
      `PR #${url.number} is ${pr.state.toLowerCase()} and its branch is not available locally`
    )
  }
  try {
    await git.raw(['fetch', 'origin', `refs/pull/${url.number}/head`])
    const fetched = (await git.raw(['rev-parse', 'FETCH_HEAD'])).trim()
    if (fetched.toLowerCase() !== pr.headOid.toLowerCase()) {
      throw new Error('PR head changed during fetch; retry the command')
    }
    await git.raw(['branch', branch, fetched])
    await git.raw(['config', '--local', key, identity])
  } catch (error) {
    throw new Error(`Could not prepare PR #${url.number} from origin: ${error}`)
  }
}

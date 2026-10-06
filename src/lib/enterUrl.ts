export type EnterUrl = {
  kind: 'github-issue' | 'github-pr'
  owner: string
  repo: string
  number: number
}

// Keep URL recognition separate from resolution: new providers add a matcher and
// resolver without changing the branch/worktree lifecycle.
const githubPaths = [
  { kind: 'github-issue', pattern: /^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/ },
  { kind: 'github-pr', pattern: /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/ },
] as const

export function parseEnterUrl(input: string): EnterUrl | null {
  if (!/^[a-z][a-z\d+.-]*:/i.test(input) && !input.startsWith('www.')) return null
  if (!/^https:\/\//i.test(input)) {
    throw new Error('Only HTTPS github.com issue and pull request URLs are supported')
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`Invalid URL: ${input}`)
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('Only HTTPS github.com issue and pull request URLs are supported')
  }

  for (const { kind, pattern } of githubPaths) {
    const match = pattern.exec(url.pathname)
    if (!match) continue
    const [, owner, repo, numberText] = match
    if (
      !owner ||
      !repo ||
      !numberText ||
      !/^[a-z\d-]+$/i.test(owner) ||
      !/^[a-z\d_.-]+$/i.test(repo) ||
      repo === '.' ||
      repo === '..'
    )
      break
    const number = Number(numberText)
    if (Number.isSafeInteger(number)) return { kind, owner, repo, number }
  }

  throw new Error('Unsupported URL. Expected https://github.com/owner/repo/issues/N or /pull/N')
}

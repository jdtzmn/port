import { afterEach, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const fixtures: string[] = []
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fixture(): { root: string; env: NodeJS.ProcessEnv; oid: string } {
  const dir = mkdtempSync(join(tmpdir(), 'port-enter-url-'))
  fixtures.push(dir)
  const root = join(dir, 'repo')
  const bare = join(dir, 'remote.git')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', '--bare', bare])
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Port Test')
  git(root, 'config', 'user.email', 'port@example.invalid')
  writeFileSync(join(root, 'README'), 'URL fixture\n')
  git(root, 'add', 'README')
  git(root, 'commit', '-qm', 'Seed')
  git(root, 'remote', 'add', 'origin', bare)
  const oid = git(root, 'rev-parse', 'HEAD')
  git(root, 'push', '-q', 'origin', 'HEAD:refs/heads/main', 'HEAD:refs/pull/57/head')

  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh\nif [ "$1" = remote ] && [ "$2" = get-url ]; then\n  printf '%s\\n' 'https://github.com/acme/app.git'\nelse\n  exec '${realGit}' "$@"\nfi\n`,
    { mode: 0o755 }
  )
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\ncase "$1:$2" in\n  api:*) if [ "$4" = user ]; then printf '%s\\n' '{"login":"demo"}'; else printf '%s\\n' '{"node_id":"repo-id","full_name":"acme/app"}'; fi ;;\n  issue:view) printf '%s\\n' '{"number":42}' ;;\n  pr:view) printf '%s\\n' '{"number":57,"headRefName":"feature/auth","headRefOid":"${oid}","isCrossRepository":true,"state":"OPEN"}' ;;\n  *) exit 1 ;;\nesac\n`,
    { mode: 0o755 }
  )
  return { root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CI: '1' }, oid }
}

function enter(root: string, env: NodeJS.ProcessEnv, url: string): string {
  return execFileSync('bun', ['run', resolve('src/index.ts'), 'enter', url], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 20000,
  })
}

describe('enter GitHub URLs with a real Git remote and stubbed GitHub metadata', () => {
  test('creates and reuses an issue worktree under the GitHub login', () => {
    const { root, env } = fixture()
    const url = 'https://github.com/acme/app/issues/42'
    enter(root, env, url)
    const path = join(root, '.port/trees/demo-issue-42')
    expect(git(path, 'branch', '--show-current')).toBe('demo/issue-42')
    enter(root, env, url)
  }, 45000)

  test('fetches a fork PR head, records its association and reuses its worktree', () => {
    const { root, env, oid } = fixture()
    const url = 'https://github.com/acme/app/pull/57'
    enter(root, env, url)
    const path = join(root, '.port/trees/feature-auth')
    expect(git(path, 'rev-parse', 'HEAD')).toBe(oid)
    expect(git(root, 'config', '--get', 'branch.feature/auth.port-pr')).toBe('acme/app#57')
    enter(root, env, url)
  }, 45000)
})

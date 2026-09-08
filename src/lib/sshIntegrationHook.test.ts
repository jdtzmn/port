import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { generateSshIntegrationHook } from './sshIntegrationHook.ts'

const pretendTty = `function [ () {
  if [[ "$*" == '! -t 0 ]' || "$*" == '! -t 1 ]' ]]; then return 1; fi
  builtin [ "$@"
}`

describe('Bash SSH integration', () => {
  let root: string
  let directory: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'port-hook-test-'))
    directory = mkdtempSync('/tmp/port-ssh-')
    for (const name of ['port', 'ssh']) {
      const file = join(root, name)
      writeFileSync(
        file,
        `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({name: '${name}', args, pid: process.pid}) + '\\n');
if ('${name}' === 'ssh') {
  if (process.env.SIGNAL) process.kill(process.ppid, 'SIG' + process.env.SIGNAL);
  process.exit(Number(process.env.SSH_STATUS || 0));
}
if (args[0] === '__remote-prepare') {
  console.error('suppressed prepare diagnostic');
  console.log(process.env.PREPARE_PATH);
  process.exit(Number(process.env.PREPARE_STATUS || 0));
}
if (args[0] === '__remote-observe') setInterval(() => {}, 1000);
if (args[0] === '__remote-cleanup') { console.log('suppressed cleanup'); process.exit(42); }
`
      )
      chmodSync(file, 0o700)
    }
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  })

  function run(body: string, env: Record<string, string> = {}, before = pretendTty) {
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-c', `${before}\n${generateSshIntegrationHook()}\n${body}`],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          CALL_LOG: join(root, 'calls'),
          PREPARE_PATH: directory,
          ...env,
        },
      }
    )
    const calls = (() => {
      try {
        return readFileSync(join(root, 'calls'), 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
      } catch {
        return []
      }
    })()
    return { ...result, calls }
  }

  test('quotes arguments, isolates traps/state, and preserves failure under errexit', () => {
    const result = run(
      `trap 'printf parent-exit' EXIT
__port_ssh_dir=parent
set -e
ssh 'a b' '' '$(touch NEVER)' 'quote"x'`,
      { SSH_STATUS: '37' }
    )
    expect(result.status).toBe(37)
    expect(result.stdout).toBe('parent-exit')
    expect(result.stderr).toBe('')
    const argv = ['a b', '', '$(touch NEVER)', 'quote"x']
    expect(
      result.calls.find(c => c.name === 'port' && c.args[0] === '__remote-prepare')?.args
    ).toEqual(['__remote-prepare', '--', ...argv])
    expect(result.calls.find(c => c.name === 'ssh')?.args).toEqual([
      '-o',
      'ControlMaster=yes',
      '-o',
      'ControlPersist=5',
      '-o',
      `ControlPath=${directory}/s`,
      ...argv,
    ])
    expect(result.calls.find(c => c.args[0] === '__remote-cleanup')?.args).toEqual([
      '__remote-cleanup',
      directory,
    ])
  })

  test('successful call leaves parent variables and traps alone', () => {
    const result = run(`__port_ssh_dir=parent
trap 'printf end' EXIT
ssh host
printf '%s' "$__port_ssh_dir"`)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('parentend')
    expect(result.stderr).toBe('')
  })

  test.each([
    '',
    '/tmp/port-ssh-abcdef/../victim',
    '/tmp/port-ssh-abcdef\nmalicious',
    '$(touch NEVER)',
  ])('rejects unsafe prepare path %j', path => {
    const result = run('set -e; ssh "host with spaces"', { PREPARE_PATH: path, SSH_STATUS: '23' })
    expect(result.status).toBe(23)
    expect(result.calls.filter(c => c.name === 'ssh').map(c => c.args)).toEqual([
      ['host with spaces'],
    ])
    expect(result.calls.some(c => c.args[0] === '__remote-cleanup')).toBe(false)
    expect(result.stderr).toBe('')
  })

  test('prepare failure falls back even when it prints a valid path', () => {
    const result = run('ssh host', { PREPARE_STATUS: '1', SSH_STATUS: '19' })
    expect(result.status).toBe(19)
    expect(result.calls.find(c => c.name === 'ssh')?.args).toEqual(['host'])
  })

  test('non-TTY calls never prepare', () => {
    const result = run('ssh host', { SSH_STATUS: '17' }, '')
    expect(result.status).toBe(17)
    expect(result.calls.map(c => c.name)).toEqual(['ssh'])
  })

  test.each(['HUP', 'INT', 'TERM'])('signal %s cleans up and preserves signal status', signal => {
    const result = run('ssh host', { SIGNAL: signal })
    expect(result.status).toBe({ HUP: 129, INT: 130, TERM: 143 }[signal])
    expect(result.calls.some(c => c.args[0] === '__remote-cleanup')).toBe(true)
    expect(result.stderr).toBe('')
  })

  test('preserves an existing function', () => {
    const result = run('ssh host', {}, `ssh() { printf existing; }`)
    expect(result.stdout).toBe('existing')
    expect(result.calls).toEqual([])
  })

  test('preserves an existing alias without parse-time expansion', () => {
    const result = run('ssh host', {}, `shopt -s expand_aliases\nalias ssh='printf alias'`)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('alias')
    expect(result.calls).toEqual([])
  })
})

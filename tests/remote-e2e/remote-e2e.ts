import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required; run remote E2E tests through tests/remote-e2e/run.sh`)
  return value
}

function composeCommand(service: string, command: readonly string[]): string[] {
  const fixtureRoot = requiredEnvironment('REMOTE_E2E_FIXTURE_ROOT')
  return [
    'docker',
    'compose',
    '--env-file',
    '/dev/null',
    '--project-directory',
    fixtureRoot,
    '-p',
    requiredEnvironment('REMOTE_E2E_PROJECT'),
    '-f',
    join(fixtureRoot, 'compose.yaml'),
    'exec',
    '-T',
    service,
    ...command,
  ]
}

export function runRemoteCommand(
  label: string,
  timeoutSeconds: number,
  service: string,
  command: readonly string[]
): void {
  const fixtureRoot = requiredEnvironment('REMOTE_E2E_FIXTURE_ROOT')
  const artifacts = requiredEnvironment('REMOTE_E2E_ARTIFACTS')
  const timings = requiredEnvironment('REMOTE_E2E_TIMINGS')
  const log = join(artifacts, `${label}.log`)
  const startedAt = performance.now()
  const result = spawnSync(
    'python3',
    [
      join(fixtureRoot, 'scenarios/bounded.py'),
      String(timeoutSeconds),
      log,
      ...composeCommand(service, command),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, COMPOSE_DISABLE_ENV_FILE: '1' },
      timeout: (timeoutSeconds + 15) * 1_000,
    }
  )
  const durationMs = Math.round(performance.now() - startedAt)
  const status = result.status ?? 1
  appendFileSync(timings, `${label}\t${durationMs}\t${status}\n`)

  if (result.error || status !== 0) {
    let tail = ''
    try {
      tail = readFileSync(log, 'utf8').slice(-8_192)
    } catch {
      // bounded.py reports its own startup failures on stderr.
    }
    throw new Error(
      [`${label} failed with status ${status}`, result.error?.message, result.stderr?.trim(), tail]
        .filter(Boolean)
        .join('\n')
    )
  }
}

export function runRemoteScenario(
  label: string,
  timeoutSeconds: number,
  scenario: string,
  args: readonly string[] = []
): void {
  runRemoteCommand(label, timeoutSeconds, 'client', ['python3', `/fixture/${scenario}.py`, ...args])
}

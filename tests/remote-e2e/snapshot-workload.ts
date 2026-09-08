// Disposable remote-a fixture seed, NOT the product's `port up` route.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { generateOverrideContent } from '../../src/lib/compose.ts'
import { buildProjectName } from '../../src/lib/projectName.ts'

const root = '/home/fixture/.port'
const registry = `${root}/registry.json`
const saved = `${root}/snapshot-fixture/registry.json`
const container = 'port-snapshot-fixture-ui'
const network = 'traefik-network'
const repo = '/home/fixture/snapshot-project'
const branch = 'feature'
// Force this remote's namespace-local DinD: never accept a caller-selected daemon.
function docker(args: string[]): string {
  return execFileSync('/usr/local/bin/docker', ['--host', 'tcp://127.0.0.1:2375', ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
function publish(content: string): void {
  writeFileSync(`${registry}.fixture-tmp`, content, { mode: 0o600 })
  renameSync(`${registry}.fixture-tmp`, registry)
}
function start(): void {
  // This directory is created exclusively for this seed; refuse a repeated start.
  mkdirSync(root, { recursive: true, mode: 0o700 })
  mkdirSync(`${root}/snapshot-fixture`, { mode: 0o700 })
  const networks = docker(['network', 'ls', '--format', '{{.Name}}']).split('\n')
  if (!networks.includes(network)) docker(['network', 'create', network])
  if (docker(['network', 'inspect', '--format', '{{.Driver}}', network]) !== 'bridge') {
    throw new Error('Fixture requires a bridge network')
  }
  const project = buildProjectName(repo, branch)
  const generated = generateOverrideContent(
    {
      name: 'snapshot-project',
      services: { ui: { ports: [{ published: 3000, target: 8080, protocol: 'tcp' }] } },
    },
    branch,
    'port',
    project
  )
  const labels: string[] = parse(generated.replaceAll('!override []', '[]')).services.ui.labels
  docker([
    'run',
    '-d',
    '--pull=never',
    '--name',
    container,
    '--network',
    network,
    ...labels.flatMap(label => ['--label', label]),
    '--label',
    `com.docker.compose.project=${project}`,
    '--label',
    'com.docker.compose.service=ui',
    'busybox:1.37.0',
    'sh',
    '-c',
    'mkdir -p /www; printf remote-a-snapshot-fixture > /www/index.html; exec httpd -f -p 8080 -h /www',
  ])
  const content = JSON.stringify({ projects: [{ repo, branch, ports: [3000] }], hostServices: [] })
  writeFileSync(saved, content, { mode: 0o600, flag: 'wx' })
  publish(content)
  // Only the selected private network address is exposed for the client's assertion.
  console.log(
    'SNAPSHOT_FIXTURE_IP=' +
      docker([
        'inspect',
        '--format',
        '{{(index .NetworkSettings.Networks "traefik-network").IPAddress}}',
        container,
      ])
  )
}
async function probe(): Promise<void> {
  const address = docker([
    'inspect',
    '--format',
    '{{(index .NetworkSettings.Networks "traefik-network").IPAddress}}',
    container,
  ])
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) throw new Error('Invalid fixture address')
  const response = await fetch(`http://${address}:8080`, {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  })
  if (!response.ok || (await response.text()) !== 'remote-a-snapshot-fixture') {
    throw new Error('Unexpected fixture HTTP identity')
  }
  console.log('SNAPSHOT_FIXTURE_REACHABLE=' + address)
}
try {
  if (process.argv.length !== 3) throw new Error('Expected one fixture mode')
  switch (process.argv[2]) {
    case 'start':
      start()
      break
    case 'probe':
      await probe()
      break
    case 'corrupt':
      readFileSync(saved)
      publish('{invalid fixture registry')
      break
    case 'restore':
      publish(readFileSync(saved, 'utf8'))
      break
    case 'stop':
      docker(['stop', '--time', '1', container])
      break
    default:
      throw new Error('Unknown fixture mode')
  }
} catch {
  // Do not dump Docker errors/inspect data or registry contents into PTY artifacts.
  console.error('Snapshot fixture operation failed')
  process.exitCode = 1
}

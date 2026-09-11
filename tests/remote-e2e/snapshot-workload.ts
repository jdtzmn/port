// Disposable remote-a fixture seed, NOT the product's `port up` route.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
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
  const id = docker([
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
    `mkdir -p /www/cgi-bin
printf remote-a-snapshot-fixture > /www/index.html
printf 0 > /www/sentinel-count
cat > /www/cgi-bin/sentinel <<'CGI'
#!/bin/sh
if [ "$REQUEST_METHOD" != POST ] || [ "$CONTENT_LENGTH" != 19 ]; then
  printf 'Status: 400 Bad Request\\r\\n\\r\\n'; exit
fi
body=$(dd bs=1 count=19 2>/dev/null)
if [ "$body" != port-stale-sentinel ]; then
  printf 'Status: 400 Bad Request\\r\\n\\r\\n'; exit
fi
# Serialize the fixture-only mutation, including accidental concurrent deliveries.
while ! mkdir /www/count-lock 2>/dev/null; do sleep 0.01; done
count=$(cat /www/sentinel-count)
printf %s "$((count + 1))" > /www/sentinel-count
rmdir /www/count-lock
printf 'Content-Type: text/plain\\r\\n\\r\\naccepted'
CGI
chmod 700 /www/cgi-bin/sentinel
exec httpd -f -p 8080 -h /www`,
  ])
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid owned container identity')
  writeFileSync(`${root}/snapshot-fixture/container-id`, id, { mode: 0o600, flag: 'wx' })
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
function productStart(machine: string): void {
  if (!/^remote-[ab]$/.test(machine)) throw new Error('Invalid fixture machine')
  const main = `${repo}/main`
  const tree = `${repo}/.port/trees/${branch}`
  mkdirSync(`${repo}/.port/trees`, { recursive: true, mode: 0o700 })
  execFileSync('git', ['init', main], { stdio: 'ignore' })
  execFileSync(
    'git',
    [
      '-C',
      main,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'Fixture',
    ],
    { stdio: 'ignore' }
  )
  execFileSync('git', ['-C', main, 'worktree', 'add', '-b', branch, tree], { stdio: 'ignore' })
  const script = `mkdir -p /www/cgi-bin
printf ${machine}-product-runtime > /www/index.html
printf 0 > /www/sentinel-count
cat > /www/cgi-bin/sentinel <<'CGI'
#!/bin/sh
body=$$(dd bs=1 count="$\${CONTENT_LENGTH:-0}" 2>/dev/null)
[ "$$REQUEST_METHOD" = POST ] && [ "$$body" = port-runtime-sentinel ] || { printf 'Status: 400 Bad Request\\r\\nContent-Type: text/plain\\r\\n\\r\\nmethod=%s length=%s body=%s' "$$REQUEST_METHOD" "$\${CONTENT_LENGTH:-unset}" "$$body"; exit; }
count=$$(cat /www/sentinel-count)
printf %s "$$((count + 1))" > /www/sentinel-count
printf 'Content-Type: text/plain\\r\\n\\r\\naccepted'
CGI
chmod 700 /www/cgi-bin/sentinel
exec httpd -f -p 8080 -h /www`
  writeFileSync(
    `${tree}/docker-compose.yml`,
    stringify({
      services: {
        ui: {
          image: 'busybox:1.37.0',
          ports: ['3100:8080'],
          command: ['sh', '-c', script],
        },
      },
    }),
    { mode: 0o600, flag: 'wx' }
  )
  execFileSync('/usr/local/bin/port', ['up'], { cwd: tree, timeout: 60_000, stdio: 'inherit' })
  const ids = docker([
    'ps',
    '--no-trunc',
    '--filter',
    'label=com.docker.compose.service=ui',
    '--format',
    '{{.ID}}',
  ])
    .split('\n')
    .filter(Boolean)
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]!))
    throw new Error('Invalid product container identity')
  writeFileSync(`${root}/product-container-id`, ids[0]!, { mode: 0o600, flag: 'wx' })
  console.log('PRODUCT_RUNTIME_STARTED')
}
function productVerifyCount(): void {
  const id = readFileSync(`${root}/product-container-id`, 'utf8')
  if (!/^[a-f0-9]{64}$/.test(id) || docker(['exec', id, 'cat', '/www/sentinel-count']) !== '1')
    throw new Error('Unexpected product sentinel count')
  console.log('PASS product sentinel count=1')
}
function productStop(): void {
  execFileSync('/usr/local/bin/port', ['down'], {
    cwd: `${repo}/.port/trees/${branch}`,
    timeout: 60_000,
    stdio: 'inherit',
  })
  console.log('PRODUCT_RUNTIME_STOPPED')
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
  if (process.argv.length < 3 || process.argv.length > 4)
    throw new Error('Expected one fixture mode and optional machine')
  switch (process.argv[2]) {
    case 'start':
      start()
      break
    case 'product-start':
      productStart(process.argv[3] ?? 'remote-a')
      break
    case 'product-verify-count':
      productVerifyCount()
      break
    case 'product-stop':
      productStop()
      break
    case 'probe':
      await probe()
      break
    case 'verify-count': {
      const id = readFileSync(`${root}/snapshot-fixture/container-id`, 'utf8')
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid owned container identity')
      if (docker(['exec', id, 'cat', '/www/sentinel-count']) !== '1')
        throw new Error('Unexpected sentinel count')
      console.log('PASS sentinel count=1')
      break
    }
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

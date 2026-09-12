// Disposable remote fixture seed and product-workload controller for remote E2E tests.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { parse, stringify } from 'yaml'
import { generateOverrideContent } from '../../../src/lib/compose.ts'
import { buildProjectName } from '../../../src/lib/projectName.ts'

const root = '/home/fixture/.port'
const registry = `${root}/registry.json`
const saved = `${root}/snapshot-fixture/registry.json`
const snapshotContainer = 'port-snapshot-fixture-ui'
const network = 'traefik-network'
const snapshotRepo = '/home/fixture/snapshot-project'
const snapshotBranch = 'feature'
const productRoot = `${root}/product-fixtures`
const productLock = `${productRoot}/operation-lock`
const owners = ['local', 'remote-a', 'remote-b'] as const
const profiles = ['full', 'ui-only', 'db-only'] as const
const branchPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const maxBranchLength = 32

type Owner = (typeof owners)[number]
type Profile = (typeof profiles)[number]

interface ProductServiceState {
  container: string
  publishedPort: number
  targetPort: number
}

interface ProductRuntimeState {
  version: 1
  owner: Owner
  branch: string
  profile: Profile
  project: string
  repo: string
  tree: string
  database: string | null
  ui: ProductServiceState | null
  db: ProductServiceState | null
}

interface ProductCounters {
  httpRequests: number
  tlsProbeRequests: number
  websocketOpens: number
  websocketMessages: number
  streamOpens: number
  streamCloses: number
  activeStreams: number
}

interface ProductStats {
  version: 1
  owner: Owner
  branch: string
  profile: Profile
  project: string
  database: string | null
  services: {
    ui: ({ available: true } & ProductServiceState & { counters: ProductCounters }) | null
    db: ProductServiceState | null
  }
}

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
  const project = buildProjectName(snapshotRepo, snapshotBranch)
  const generated = generateOverrideContent(
    {
      name: 'snapshot-project',
      services: { ui: { ports: [{ published: 3000, target: 8080, protocol: 'tcp' }] } },
    },
    snapshotBranch,
    'port',
    project
  )
  const labels: string[] = parse(generated.replaceAll('!override []', '[]')).services.ui.labels
  const id = docker([
    'run',
    '-d',
    '--pull=never',
    '--name',
    snapshotContainer,
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
  const content = JSON.stringify({
    projects: [{ repo: snapshotRepo, branch: snapshotBranch, ports: [3000] }],
    hostServices: [],
  })
  writeFileSync(saved, content, { mode: 0o600, flag: 'wx' })
  publish(content)
  // Only the selected private network address is exposed for the client's assertion.
  console.log(
    'SNAPSHOT_FIXTURE_IP=' +
      docker([
        'inspect',
        '--format',
        '{{(index .NetworkSettings.Networks "traefik-network").IPAddress}}',
        snapshotContainer,
      ])
  )
}

function parseOwner(value: string | undefined, fallback?: Owner): Owner {
  if (value === undefined && fallback) return fallback
  if (!owners.includes(value as Owner)) throw new Error('Invalid fixture owner')
  return value as Owner
}

function parseProfile(value: string | undefined, fallback?: Profile): Profile {
  if (value === undefined && fallback) return fallback
  if (!profiles.includes(value as Profile)) throw new Error('Invalid fixture profile')
  return value as Profile
}

function parseBranch(value: string | undefined, fallback?: string): string {
  const branch = value ?? fallback
  if (
    branch === undefined ||
    branch.length > maxBranchLength ||
    !branchPattern.test(branch) ||
    branch === 'main' ||
    branch === 'master'
  ) {
    throw new Error('Invalid fixture branch')
  }
  return branch
}

function expectArgCount(args: string[], minimum: number, maximum = minimum): void {
  if (args.length < minimum || args.length > maximum) throw new Error('Invalid fixture arguments')
}

function ownerRoot(owner: Owner): string {
  return `${productRoot}/${owner}`
}

function productRepo(owner: Owner): string {
  return `${ownerRoot(owner)}/port-snapshot-project-${owner}`
}

function stateDirectory(owner: Owner): string {
  return `${ownerRoot(owner)}/states`
}

function statePath(owner: Owner, branch: string): string {
  return `${stateDirectory(owner)}/${branch}.json`
}

function productTree(owner: Owner, branch: string): string {
  return `${productRepo(owner)}/.port/trees/${branch}`
}

function productDatabase(owner: Owner, branch: string, legacy: boolean): string {
  const identity = legacy ? owner : `${owner}_${branch}`
  return `${identity.replaceAll('-', '_')}_automatic`
}

function assertPort(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1024 || (value as number) > 65_535) {
    throw new Error('Invalid fixture port')
  }
}

function parseServiceState(value: unknown): ProductServiceState | null {
  if (value === null) return null
  if (typeof value !== 'object' || value === null) throw new Error('Invalid fixture service state')
  const service = value as Record<string, unknown>
  if (typeof service.container !== 'string' || !/^port-[a-z0-9-]+$/.test(service.container)) {
    throw new Error('Invalid fixture container')
  }
  assertPort(service.publishedPort)
  assertPort(service.targetPort)
  return {
    container: service.container,
    publishedPort: service.publishedPort,
    targetPort: service.targetPort,
  }
}

function parseRuntimeState(content: string): ProductRuntimeState {
  const value: unknown = JSON.parse(content)
  if (typeof value !== 'object' || value === null) throw new Error('Invalid fixture state')
  const state = value as Record<string, unknown>
  const owner = parseOwner(typeof state.owner === 'string' ? state.owner : undefined)
  const branch = parseBranch(typeof state.branch === 'string' ? state.branch : undefined)
  const profile = parseProfile(typeof state.profile === 'string' ? state.profile : undefined)
  const repo = productRepo(owner)
  const tree = productTree(owner, branch)
  const project = buildProjectName(repo, branch)
  if (
    state.version !== 1 ||
    state.repo !== repo ||
    state.tree !== tree ||
    state.project !== project ||
    (state.database !== null &&
      (typeof state.database !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(state.database)))
  ) {
    throw new Error('Invalid fixture state')
  }
  const ui = parseServiceState(state.ui)
  const db = parseServiceState(state.db)
  if ((profile === 'db-only') !== (ui === null) || (profile === 'ui-only') !== (db === null)) {
    throw new Error('Invalid fixture profile state')
  }
  if ((db === null) !== (state.database === null)) throw new Error('Invalid fixture database state')
  return {
    version: 1,
    owner,
    branch,
    profile,
    project,
    repo,
    tree,
    database: state.database as string | null,
    ui,
    db,
  }
}

function readRuntimeState(owner: Owner, branch: string): ProductRuntimeState {
  return parseRuntimeState(readFileSync(statePath(owner, branch), 'utf8'))
}

function listRuntimeStates(owner?: Owner): ProductRuntimeState[] {
  const selectedOwners = owner ? [owner] : [...owners]
  const states: ProductRuntimeState[] = []
  for (const candidate of selectedOwners) {
    const directory = stateDirectory(candidate)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json'))
        throw new Error('Invalid fixture state entry')
      const branch = parseBranch(entry.name.slice(0, -'.json'.length))
      const state = readRuntimeState(candidate, branch)
      if (state.owner !== candidate || state.branch !== branch)
        throw new Error('Invalid fixture state key')
      states.push(state)
    }
  }
  return states.sort((left, right) =>
    `${left.owner}/${left.branch}`.localeCompare(`${right.owner}/${right.branch}`)
  )
}

function withProductLock<T>(operation: () => T): T {
  mkdirSync(productRoot, { recursive: true, mode: 0o700 })
  mkdirSync(productLock, { mode: 0o700 })
  try {
    return operation()
  } finally {
    rmSync(productLock, { recursive: true, force: true })
  }
}

function stableSlot(owner: Owner, branch: string, used: Set<number>): number {
  let hash = 5381
  for (const character of `${owner}/${branch}`) hash = ((hash * 33) ^ character.charCodeAt(0)) >>> 0
  const slotCount = 400
  const preferred = hash % slotCount
  for (let offset = 0; offset < slotCount; offset += 1) {
    const slot = (preferred + offset) % slotCount
    if (!used.has(slot)) return slot
  }
  throw new Error('Fixture port capacity exhausted')
}

function allocateServices(
  owner: Owner,
  branch: string,
  profile: Profile,
  legacy: boolean
): Pick<ProductRuntimeState, 'ui' | 'db' | 'database'> {
  const project = buildProjectName(productRepo(owner), branch)
  if (legacy) {
    return {
      ui:
        profile === 'db-only'
          ? null
          : { container: `${project}-ui`, publishedPort: 3100, targetPort: 8080 },
      db:
        profile === 'ui-only'
          ? null
          : { container: `${project}-db`, publishedPort: 5432, targetPort: 5432 },
      database: profile === 'ui-only' ? null : productDatabase(owner, branch, true),
    }
  }

  const used = new Set<number>()
  for (const state of listRuntimeStates()) {
    const slot = state.ui
      ? state.ui.publishedPort - 3200
      : state.db
        ? state.db.publishedPort - 5500
        : -1
    if (slot >= 0 && slot < 400) used.add(slot)
  }
  const slot = stableSlot(owner, branch, used)
  return {
    ui:
      profile === 'db-only'
        ? null
        : {
            container: `${project}-ui`,
            publishedPort: 3200 + slot,
            targetPort: 8080,
          },
    db:
      profile === 'ui-only'
        ? null
        : {
            container: `${project}-db`,
            publishedPort: 5500 + slot,
            targetPort: 5432,
          },
    database: profile === 'ui-only' ? null : productDatabase(owner, branch, false),
  }
}

function initializeProductRepository(owner: Owner): void {
  const repo = productRepo(owner)
  const main = `${repo}/main`
  mkdirSync(`${repo}/.port/trees`, { recursive: true, mode: 0o700 })
  if (existsSync(`${main}/.git`)) return
  if (existsSync(main)) throw new Error('Product repository identity already exists')
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
}

function productServerScript(state: ProductRuntimeState): string {
  if (!state.ui) throw new Error('Missing product UI state')
  const runtime = JSON.stringify({
    version: 1,
    owner: state.owner,
    branch: state.branch,
    profile: state.profile,
    project: state.project,
    service: 'ui',
    identity: `${state.owner}-product-runtime`,
  })
  return `cat > /server.ts <<'SERVER'
const runtime = ${runtime}
const counters = {
  httpRequests: 0,
  tlsProbeRequests: 0,
  websocketOpens: 0,
  websocketMessages: 0,
  streamOpens: 0,
  streamCloses: 0,
  activeStreams: 0,
}
let sentinelCount = 0
const encoder = new TextEncoder()
const snapshot = () => ({ ...runtime, counters: { ...counters } })
Bun.serve({
  port: ${state.ui.targetPort},
  async fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      if (server.upgrade(request)) return
      return new Response('websocket upgrade required', { status: 426 })
    }
    if (url.pathname === '/__fixture/stats') {
      return Response.json(snapshot(), { headers: { 'cache-control': 'no-store' } })
    }
    if (url.pathname === '/__fixture/stream') {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })
      let timer
      let lifetime
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        if (timer) clearInterval(timer)
        if (lifetime) clearTimeout(lifetime)
        counters.activeStreams -= 1
        counters.streamCloses += 1
      }
      const stream = new ReadableStream({
        start(controller) {
          counters.streamOpens += 1
          counters.activeStreams += 1
          controller.enqueue(encoder.encode(JSON.stringify({ ...runtime, event: 'open' }) + '\\n'))
          timer = setInterval(() => {
            controller.enqueue(encoder.encode(JSON.stringify({ ...runtime, event: 'heartbeat' }) + '\\n'))
          }, 1000)
          lifetime = setTimeout(() => {
            close()
            controller.close()
          }, 300000)
          request.signal.addEventListener('abort', close, { once: true })
        },
        cancel() { close() },
      })
      return new Response(stream, {
        headers: {
          'content-type': 'application/x-ndjson',
          'cache-control': 'no-store',
          'x-fixture-owner': runtime.owner,
          'x-fixture-branch': runtime.branch,
        },
      })
    }
    if (url.pathname === '/__fixture/probe/http') {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })
      counters.httpRequests += 1
      return Response.json({ ...runtime, probe: 'http' })
    }
    if (url.pathname === '/__fixture/probe/tls') {
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })
      counters.tlsProbeRequests += 1
      return Response.json({ ...runtime, probe: 'tls' })
    }
    const forwardedProtocol = request.headers.get('x-forwarded-proto')
    if (forwardedProtocol === 'https') counters.tlsProbeRequests += 1
    else counters.httpRequests += 1
    if (url.pathname === '/cgi-bin/sentinel') {
      if (request.method === 'GET') return new Response(String(sentinelCount))
      if (request.method === 'POST' && (await request.text()) === 'port-runtime-sentinel') {
        sentinelCount += 1
        return new Response('accepted')
      }
      return new Response('invalid sentinel request', { status: 400 })
    }
    return new Response(runtime.identity)
  },
  websocket: {
    open(socket) {
      counters.websocketOpens += 1
      socket.send(runtime.identity + '-ws-ready')
    },
    message(socket, message) {
      counters.websocketMessages += 1
      socket.send(runtime.identity + '-ws-echo:' + message)
    },
  },
})
SERVER
exec bun /server.ts`
}

function releaseProductPostgresPort(): void {
  if (!existsSync('/tmp/port-product-postgres.stopped')) {
    if (!existsSync('/tmp/port-product-postgres.stop')) {
      writeFileSync('/tmp/port-product-postgres.stop', '', { mode: 0o600, flag: 'wx' })
    }
    const deadline = Date.now() + 10_000
    while (!existsSync('/tmp/port-product-postgres.stopped')) {
      if (Date.now() >= deadline) throw new Error('Product PostgreSQL port was not released')
      execFileSync('sleep', ['0.1'])
    }
  }
}

function productStart(args: string[]): void {
  expectArgCount(args, 0, 3)
  const owner = parseOwner(args[0], 'remote-a')
  const branch = parseBranch(args[1], 'feature')
  const profile = parseProfile(args[2], 'full')
  // Existing one-machine callers retain feature.port:3100 and PostgreSQL :5432.
  const legacy = args.length <= 1 && branch === 'feature' && profile === 'full'

  withProductLock(() => {
    mkdirSync(stateDirectory(owner), { recursive: true, mode: 0o700 })
    const file = statePath(owner, branch)
    const tree = productTree(owner, branch)
    if (existsSync(file) || existsSync(tree)) throw new Error('Product runtime already exists')
    initializeProductRepository(owner)
    const repo = productRepo(owner)
    const project = buildProjectName(repo, branch)
    const services = allocateServices(owner, branch, profile, legacy)
    const state: ProductRuntimeState = {
      version: 1,
      owner,
      branch,
      profile,
      project,
      repo,
      tree,
      ...services,
    }
    execFileSync('git', ['-C', `${repo}/main`, 'worktree', 'add', '-b', branch, tree], {
      stdio: 'ignore',
    })

    const composeServices: Record<string, unknown> = {}
    if (state.ui) {
      composeServices.ui = {
        image: 'oven/bun:1.3.3',
        container_name: state.ui.container,
        ports: [`${state.ui.publishedPort}:${state.ui.targetPort}`],
        command: ['sh', '-c', productServerScript(state)],
      }
    }
    if (state.db) {
      composeServices.db = {
        image: 'postgres:17.4-bookworm',
        container_name: state.db.container,
        ports: [`${state.db.publishedPort}:${state.db.targetPort}`],
        command: ['postgres', '-c', `port=${state.db.targetPort}`],
        environment: {
          POSTGRES_DB: state.database,
          POSTGRES_HOST_AUTH_METHOD: 'trust',
        },
      }
      if (state.db.publishedPort === 5432) releaseProductPostgresPort()
    }
    writeFileSync(`${tree}/docker-compose.yml`, stringify({ services: composeServices }), {
      mode: 0o600,
      flag: 'wx',
    })
    writeFileSync(file, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
    execFileSync('/usr/local/bin/port', ['up'], { cwd: tree, timeout: 60_000, stdio: 'inherit' })
    console.log('PRODUCT_RUNTIME=' + JSON.stringify(state))
    console.log('PRODUCT_RUNTIME_STARTED')
  })
}

function removeWorktree(state: ProductRuntimeState): void {
  execFileSync('/usr/local/bin/port', ['down', '--yes'], {
    cwd: state.tree,
    timeout: 60_000,
    stdio: 'inherit',
  })
  execFileSync('git', ['-C', `${state.repo}/main`, 'worktree', 'remove', '--force', state.tree], {
    stdio: 'ignore',
  })
  execFileSync('git', ['-C', `${state.repo}/main`, 'branch', '-D', state.branch], {
    stdio: 'ignore',
  })
  rmSync(statePath(state.owner, state.branch), { force: true })
}

function removeEmptyOwner(owner: Owner): void {
  if (listRuntimeStates(owner).length === 0)
    rmSync(ownerRoot(owner), { recursive: true, force: true })
}

function productStop(args: string[]): void {
  expectArgCount(args, 0, 2)
  withProductLock(() => {
    if (args.length === 0) {
      const states = listRuntimeStates()
      for (const state of states) removeWorktree(state)
      rmSync(productRoot, { recursive: true, force: true })
      console.log(`PRODUCT_RUNTIMES_STOPPED=${states.length}`)
      console.log('PRODUCT_RUNTIME_STOPPED')
      return
    }
    const owner = parseOwner(args[0])
    const branch = parseBranch(args[1], 'feature')
    const state = readRuntimeState(owner, branch)
    removeWorktree(state)
    removeEmptyOwner(owner)
    console.log('PRODUCT_RUNTIME_STOPPED=' + JSON.stringify({ owner, branch }))
  })
}

function productStopAll(args: string[]): void {
  expectArgCount(args, 0, 1)
  const owner = args.length === 1 ? parseOwner(args[0]) : undefined
  withProductLock(() => {
    const states = listRuntimeStates(owner)
    for (const state of states) removeWorktree(state)
    if (owner) removeEmptyOwner(owner)
    else rmSync(productRoot, { recursive: true, force: true })
    console.log(`PRODUCT_RUNTIMES_STOPPED=${states.length}`)
  })
}

function validAddress(address: string): boolean {
  const parts = address.split('.')
  return (
    parts.length === 4 &&
    parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  )
}

function parseCounters(value: unknown): ProductCounters {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid fixture counters')
  const counters = value as Record<string, unknown>
  const names: Array<keyof ProductCounters> = [
    'httpRequests',
    'tlsProbeRequests',
    'websocketOpens',
    'websocketMessages',
    'streamOpens',
    'streamCloses',
    'activeStreams',
  ]
  for (const name of names) {
    if (!Number.isSafeInteger(counters[name]) || (counters[name] as number) < 0) {
      throw new Error('Invalid fixture counters')
    }
  }
  return Object.fromEntries(names.map(name => [name, counters[name]])) as unknown as ProductCounters
}

async function readProductStats(state: ProductRuntimeState): Promise<ProductStats> {
  let ui: ProductStats['services']['ui'] = null
  if (state.ui) {
    const address = docker([
      'inspect',
      '--format',
      '{{(index .NetworkSettings.Networks "traefik-network").IPAddress}}',
      state.ui.container,
    ])
    if (!validAddress(address)) throw new Error('Invalid fixture address')
    const response = await fetch(`http://${address}:${state.ui.targetPort}/__fixture/stats`, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error('Product stats request failed')
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) throw new Error('Invalid product stats')
    const result = payload as Record<string, unknown>
    if (
      result.version !== 1 ||
      result.owner !== state.owner ||
      result.branch !== state.branch ||
      result.profile !== state.profile ||
      result.project !== state.project ||
      result.service !== 'ui'
    ) {
      throw new Error('Mismatched product stats')
    }
    ui = { available: true, ...state.ui, counters: parseCounters(result.counters) }
  }
  return {
    version: 1,
    owner: state.owner,
    branch: state.branch,
    profile: state.profile,
    project: state.project,
    database: state.database,
    services: { ui, db: state.db },
  }
}

async function productStats(args: string[]): Promise<void> {
  expectArgCount(args, 0, 2)
  const owner = args.length >= 1 ? parseOwner(args[0]) : undefined
  const branch = args.length === 2 ? parseBranch(args[1]) : undefined
  const states = branch ? [readRuntimeState(owner as Owner, branch)] : listRuntimeStates(owner)
  const stats: ProductStats[] = []
  for (const state of states) stats.push(await readProductStats(state))
  console.log('PRODUCT_STATS=' + JSON.stringify({ version: 1, runtimes: stats }))
}

async function probe(): Promise<void> {
  const address = docker([
    'inspect',
    '--format',
    '{{(index .NetworkSettings.Networks "traefik-network").IPAddress}}',
    snapshotContainer,
  ])
  if (!validAddress(address)) throw new Error('Invalid fixture address')
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
  const [mode, ...args] = process.argv.slice(2)
  if (!mode) throw new Error('Expected fixture mode')
  switch (mode) {
    case 'start':
      expectArgCount(args, 0)
      start()
      break
    case 'product-start':
      productStart(args)
      break
    case 'product-stop':
      productStop(args)
      break
    case 'product-stop-all':
      productStopAll(args)
      break
    case 'product-stats':
      await productStats(args)
      break
    case 'probe':
      expectArgCount(args, 0)
      await probe()
      break
    case 'verify-count': {
      expectArgCount(args, 0)
      const id = readFileSync(`${root}/snapshot-fixture/container-id`, 'utf8')
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid owned container identity')
      if (docker(['exec', id, 'cat', '/www/sentinel-count']) !== '1') {
        throw new Error('Unexpected sentinel count')
      }
      console.log('PASS sentinel count=1')
      break
    }
    case 'corrupt':
      expectArgCount(args, 0)
      readFileSync(saved)
      publish('{invalid fixture registry')
      break
    case 'restore':
      expectArgCount(args, 0)
      publish(readFileSync(saved, 'utf8'))
      break
    case 'stop':
      expectArgCount(args, 0)
      docker(['stop', '--time', '1', snapshotContainer])
      break
    default:
      throw new Error('Unknown fixture mode')
  }
} catch (error) {
  // Do not dump Docker errors/inspect data, registry contents, or rejected arguments into PTY artifacts.
  const message = error instanceof Error ? error.message : ''
  if (
    message.startsWith('Invalid product UI container identity count:') ||
    message === 'Product identity marker already exists'
  ) {
    console.error(message)
  } else {
    console.error('Snapshot fixture operation failed')
  }
  process.exitCode = 1
}

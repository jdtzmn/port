import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import {
  evaluateBudget,
  summarizeSamples,
  toBenchmarkEntry,
  type BenchmarkSummary,
} from '../src/lib/benchmark.ts'
import {
  BENCHMARK_DEFINITIONS,
  type BenchmarkCategory,
  type BenchmarkDefinition,
  type BenchmarkId,
} from '../src/lib/benchmarkPolicy.ts'

const execFileAsync = promisify(execFile)
const WARMUP_COUNT = Number.parseInt(process.env.BENCHMARK_WARMUPS ?? '5', 10)
const SAMPLE_COUNT = Number.parseInt(process.env.BENCHMARK_SAMPLES ?? '20', 10)
const INCLUDE_DOCKER = process.env.BENCHMARK_INCLUDE_DOCKER === '1'
const OUTPUT_DIR = resolve(process.env.BENCHMARK_OUTPUT_DIR ?? 'benchmark-results')
const CLI_PATH = resolve('dist/index.js')
const LARGE_WORKTREE_COUNT = 32

interface Fixture {
  root: string
  globalDir: string
}

interface BenchmarkResult {
  id: BenchmarkId
  category: BenchmarkCategory
  name: string
  budget: BenchmarkDefinition['budget']
  summary: BenchmarkSummary
  passed: boolean
}

function assertValidRunSettings(): void {
  if (!Number.isInteger(WARMUP_COUNT) || WARMUP_COUNT < 0) {
    throw new Error('BENCHMARK_WARMUPS must be a non-negative integer')
  }

  if (!Number.isInteger(SAMPLE_COUNT) || SAMPLE_COUNT < 1) {
    throw new Error('BENCHMARK_SAMPLES must be a positive integer')
  }
}

async function run(
  command: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv
): Promise<void> {
  await execFileAsync(command, args, {
    cwd,
    env,
    maxBuffer: 10 * 1024 * 1024,
  })
}

async function runPort(fixture: Fixture, args: string[]): Promise<void> {
  await run('bun', [CLI_PATH, ...args], fixture.root, {
    ...process.env,
    PORT_GLOBAL_DIR: fixture.globalDir,
  })
}

async function prepareFixture(worktreeCount: number): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'port-benchmark-'))
  const globalDir = await mkdtemp(join(tmpdir(), 'port-benchmark-global-'))

  await mkdir(join(root, '.port'), { recursive: true })
  await writeFile(join(root, '.port', 'config.jsonc'), '{"domain":"test"}\n')
  await writeFile(
    join(root, 'docker-compose.yml'),
    `services:
  sleeper-one:
    image: alpine:3.20
    command: ["sh", "-c", "sleep infinity"]
  sleeper-two:
    image: alpine:3.20
    command: ["sh", "-c", "sleep infinity"]
  sleeper-three:
    image: alpine:3.20
    command: ["sh", "-c", "sleep infinity"]
`
  )

  await run('git', ['init'], root)
  await run('git', ['config', 'user.email', 'benchmark@test.local'], root)
  await run('git', ['config', 'user.name', 'Benchmark Runner'], root)
  await run('git', ['add', '.'], root)
  await run('git', ['commit', '-m', 'Initial benchmark fixture'], root)
  await run('git', ['branch', '-M', 'main'], root)

  const fixture = { root, globalDir }
  for (let index = 0; index < worktreeCount; index += 1) {
    await runPort(fixture, ['enter', `benchmark-${index}`])
  }

  return fixture
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true })
  await rm(fixture.globalDir, { recursive: true, force: true })
}

async function measure(operation: () => Promise<void>): Promise<BenchmarkSummary> {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    await operation()
  }

  const samples: number[] = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const start = performance.now()
    await operation()
    samples.push(performance.now() - start)
  }

  return summarizeSamples(samples)
}

async function measureNewWorktree(fixture: Fixture, prefix: string): Promise<BenchmarkSummary> {
  let runNumber = 0

  return measure(async () => {
    const branch = `${prefix}-${runNumber}`
    const worktreePath = join(fixture.root, '.port', 'trees', branch)
    runNumber += 1

    await runPort(fixture, ['enter', branch])
    await run('git', ['worktree', 'remove', '--force', worktreePath], fixture.root)
    await run('git', ['branch', '--delete', '--force', branch], fixture.root)
  })
}

async function resetDockerProject(fixture: Fixture): Promise<void> {
  await run(
    'docker',
    ['compose', '--project-name', basename(fixture.root), 'down', '--remove-orphans'],
    fixture.root
  )
}

async function measureWarmUp(fixture: Fixture): Promise<BenchmarkSummary> {
  await runPort(fixture, ['up'])
  await resetDockerProject(fixture)

  return measure(async () => {
    await runPort(fixture, ['up'])
    await resetDockerProject(fixture)
  })
}

function result(definition: BenchmarkDefinition, summary: BenchmarkSummary): BenchmarkResult {
  const budget = evaluateBudget(definition.budget, summary.p95)

  return {
    id: definition.id,
    category: definition.category,
    name: definition.name,
    budget: definition.budget,
    summary,
    passed: budget.passed,
  }
}

async function writeResults(results: BenchmarkResult[]): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true })

  const metadata = {
    generatedAt: new Date().toISOString(),
    gitSha: process.env.GITHUB_SHA ?? null,
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    warmups: WARMUP_COUNT,
    samples: SAMPLE_COUNT,
  }

  await writeFile(
    join(OUTPUT_DIR, 'raw.json'),
    `${JSON.stringify({ metadata, results }, null, 2)}\n`
  )

  const categories: BenchmarkCategory[] = ['cli', 'worktree', 'docker']
  await Promise.all(
    categories.map(async category => {
      const entries = results
        .filter(entry => entry.category === category)
        .map(entry => toBenchmarkEntry(entry.name, entry.summary))
      await writeFile(join(OUTPUT_DIR, `${category}.json`), `${JSON.stringify(entries, null, 2)}\n`)
    })
  )
}

async function main(): Promise<void> {
  assertValidRunSettings()

  const smallFixture = await prepareFixture(1)
  const largeFixture = await prepareFixture(LARGE_WORKTREE_COUNT)

  try {
    const results: BenchmarkResult[] = []

    results.push(
      result(BENCHMARK_DEFINITIONS.help, await measure(() => run('bun', [CLI_PATH, '--help'])))
    )
    results.push(
      result(
        BENCHMARK_DEFINITIONS['list-small'],
        await measure(() => runPort(smallFixture, ['list']))
      )
    )
    results.push(
      result(
        BENCHMARK_DEFINITIONS['list-large'],
        await measure(() => runPort(largeFixture, ['list']))
      )
    )
    results.push(
      result(
        BENCHMARK_DEFINITIONS['enter-existing-small'],
        await measure(() => runPort(smallFixture, ['enter', 'benchmark-0']))
      )
    )
    results.push(
      result(
        BENCHMARK_DEFINITIONS['enter-existing-large'],
        await measure(() => runPort(largeFixture, ['enter', 'benchmark-0']))
      )
    )
    results.push(
      result(
        BENCHMARK_DEFINITIONS['enter-new-small'],
        await measureNewWorktree(smallFixture, 'new-small')
      )
    )
    results.push(
      result(
        BENCHMARK_DEFINITIONS['enter-new-large'],
        await measureNewWorktree(largeFixture, 'new-large')
      )
    )

    if (INCLUDE_DOCKER) {
      results.push(
        result(
          BENCHMARK_DEFINITIONS['status-small'],
          await measure(() => runPort(smallFixture, ['status']))
        )
      )
      results.push(
        result(
          BENCHMARK_DEFINITIONS['status-large'],
          await measure(() => runPort(largeFixture, ['status']))
        )
      )
      results.push(result(BENCHMARK_DEFINITIONS['up-warm'], await measureWarmUp(smallFixture)))
    }

    await writeResults(results)

    for (const entry of results) {
      const status = entry.passed ? 'PASS' : 'FAIL'
      console.log(
        `${status} ${entry.name}: p50 ${entry.summary.median} ms, p95 ${entry.summary.p95} ms`
      )
    }
  } finally {
    await Promise.all([cleanupFixture(smallFixture), cleanupFixture(largeFixture)])
  }
}

await main()

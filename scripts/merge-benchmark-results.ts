import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { toBenchmarkEntry, type BenchmarkSummary } from '../src/lib/benchmark.ts'
import type { BenchmarkCategory } from '../src/lib/benchmarkPolicy.ts'

interface BenchmarkResult {
  id: string
  category: BenchmarkCategory
  name: string
  budget: {
    p95: number
  }
  summary: BenchmarkSummary
  passed: boolean
}

interface BenchmarkReport {
  metadata: Record<string, unknown>
  results: BenchmarkResult[]
}

const [inputDir = 'benchmark-inputs', outputDir = 'benchmark-results'] = process.argv.slice(2)
const resolvedInputDir = resolve(inputDir)
const resolvedOutputDir = resolve(outputDir)
const artifactDirectories = await readdir(resolvedInputDir, { withFileTypes: true })
const reports = await Promise.all(
  artifactDirectories
    .filter(entry => entry.isDirectory())
    .map(async entry => {
      const file = join(resolvedInputDir, entry.name, 'raw.json')
      return JSON.parse(await readFile(file, 'utf8')) as BenchmarkReport
    })
)
const results = reports.flatMap(report => report.results)
const duplicateIds = results.filter(
  (result, index) => results.findIndex(other => other.id === result.id) !== index
)

if (duplicateIds.length > 0) {
  throw new Error(
    `Duplicate benchmark result IDs: ${duplicateIds.map(result => result.id).join(', ')}`
  )
}

await mkdir(resolvedOutputDir, { recursive: true })
await writeFile(
  join(resolvedOutputDir, 'raw.json'),
  `${JSON.stringify(
    {
      metadata: {
        generatedAt: new Date().toISOString(),
        sourceReports: reports.map(report => report.metadata),
      },
      results,
    },
    null,
    2
  )}\n`
)

const categories: BenchmarkCategory[] = ['cli', 'worktree', 'docker']
await Promise.all(
  categories.map(async category => {
    const entries = results
      .filter(result => result.category === category)
      .map(result => toBenchmarkEntry(result.name, result.summary))
    await writeFile(
      join(resolvedOutputDir, `${category}.json`),
      `${JSON.stringify(entries, null, 2)}\n`
    )
  })
)

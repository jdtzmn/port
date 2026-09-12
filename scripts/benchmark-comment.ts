import { readFile } from 'fs/promises'
import { resolve } from 'path'

type BenchmarkCategory = 'cli' | 'worktree' | 'docker'

interface BenchmarkResult {
  category: BenchmarkCategory
  name: string
  summary: {
    median: number
    p95: number
  }
  budget: {
    p95: number
  }
  passed: boolean
}

interface BenchmarkReport {
  results: BenchmarkResult[]
}

const [reportFile = 'benchmark-results/raw.json'] = process.argv.slice(2)
const report = JSON.parse(await readFile(resolve(reportFile), 'utf8')) as BenchmarkReport
const categories: Array<[BenchmarkCategory, string]> = [
  ['cli', 'CLI responsiveness'],
  ['worktree', 'Worktree operations'],
  ['docker', 'Docker operations'],
]

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`
}

function renderCategory(category: BenchmarkCategory, title: string): string {
  const results = report.results.filter(result => result.category === category)
  if (results.length === 0) {
    return ''
  }

  const rows = results.map(result => {
    const status = result.passed ? '✅' : '❌'
    return `| ${status} ${result.name} | ${formatMs(result.summary.median)} | ${formatMs(result.summary.p95)} | ${formatMs(result.budget.p95)} |`
  })

  return `### ${title}
| Benchmark | p50 | p95 | p95 budget |
| --- | ---: | ---: | ---: |
${rows.join('\n')}`
}

const sections = categories
  .map(([category, title]) => renderCategory(category, title))
  .filter(Boolean)
const artifactUrl =
  process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}#artifacts`
    : undefined
const previewLink = artifactUrl ? `\n\n[Download the interactive PR preview](${artifactUrl}).` : ''

console.log(`<!-- port-benchmark-report -->
## Benchmark report

This sticky comment is updated by each benchmark run. The PR preview is not persisted until merge.

${sections.join('\n\n')}${previewLink}

_(Drafted by Jacob's coding agent on his behalf)_`)

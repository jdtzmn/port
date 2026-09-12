import { readFile } from 'fs/promises'
import { resolve } from 'path'

interface Result {
  name: string
  passed: boolean
  summary: {
    p95: number
  }
  budget: {
    p95: number
  }
}

interface BenchmarkReport {
  results: Result[]
}

const reportPath = resolve(process.argv[2] ?? 'benchmark-results/raw.json')
const report = JSON.parse(await readFile(reportPath, 'utf8')) as BenchmarkReport
const failures = report.results.filter(result => !result.passed)

if (failures.length === 0) {
  console.log('All benchmark p95 budgets passed.')
} else {
  for (const failure of failures) {
    console.error(
      `Budget exceeded: ${failure.name} p95 ${failure.summary.p95} ms (limit ${failure.budget.p95} ms)`
    )
  }
  process.exitCode = 1
}

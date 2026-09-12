import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, resolve } from 'path'

interface BenchmarkResult {
  category: 'cli' | 'worktree' | 'docker'
  name: string
  summary: {
    median: number
    p95: number
  }
  budget: {
    p95: number
  }
}

interface BenchmarkReport {
  results: BenchmarkResult[]
}

interface HistoryEntry {
  benches: Array<{
    name: string
    value: number
  }>
}

interface HistoryData {
  entries?: Record<string, HistoryEntry[]>
}

const [
  reportFile = 'benchmark-results/raw.json',
  historyDir = 'benchmark-history',
  outputFile = 'benchmark-results/preview.html',
] = process.argv.slice(2)
const report = JSON.parse(await readFile(resolve(reportFile), 'utf8')) as BenchmarkReport
const colors = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24']

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return entities[character]!
  })
}

async function readHistory(category: BenchmarkResult['category']): Promise<HistoryData> {
  try {
    const source = await readFile(join(resolve(historyDir), `${category}-data.js`), 'utf8')
    const json = source.replace(/^window\.BENCHMARK_DATA\s*=\s*/, '').replace(/;\s*$/, '')
    return JSON.parse(json) as HistoryData
  } catch {
    return {}
  }
}

function linePath(values: number[], maxValue: number, maxPoints: number): string {
  return values
    .map((value, index) => {
      const x = 48 + (index / Math.max(1, maxPoints - 1)) * 632
      const y = 218 - (value / maxValue) * 176
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

async function chart(category: BenchmarkResult['category']): Promise<string> {
  const current = report.results.filter(result => result.category === category)
  if (current.length === 0) {
    return ''
  }

  const history = await readHistory(category)
  const historicEntries = Object.values(history.entries ?? {}).flat()
  const series = current.map((result, index) => {
    const historicValues = historicEntries
      .map(entry => entry.benches.find(bench => bench.name === result.name)?.value)
      .filter((value): value is number => value !== undefined)
    return { ...result, color: colors[index]!, values: [...historicValues, result.summary.median] }
  })
  const maxValue = Math.max(1, ...series.flatMap(item => item.values))
  const maxPoints = Math.max(...series.map(item => item.values.length))
  const title = `${category[0]!.toUpperCase()}${category.slice(1)} operations`

  const paths = series
    .map(
      item =>
        `<path d="${linePath(item.values, maxValue, maxPoints)}" fill="none" stroke="${item.color}" stroke-width="3" />`
    )
    .join('')
  const points = series
    .map(item => {
      const index = item.values.length - 1
      const x = 48 + (index / Math.max(1, maxPoints - 1)) * 632
      const y = 218 - (item.values[index]! / maxValue) * 176
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${item.color}" />`
    })
    .join('')
  const legend = series
    .map(item => `<li><span style="background:${item.color}"></span>${escapeHtml(item.name)}</li>`)
    .join('')
  const rows = series
    .map(
      item =>
        `<tr><td>${escapeHtml(item.name)}</td><td>${item.summary.median} ms</td><td>${item.summary.p95} ms</td><td>${item.budget.p95} ms</td></tr>`
    )
    .join('')

  return `<section><h2>${title}</h2><svg viewBox="0 0 720 250" role="img" aria-label="${title} benchmark history"><line x1="48" y1="218" x2="680" y2="218" stroke="#64748b"/><line x1="48" y1="42" x2="48" y2="218" stroke="#64748b"/>${paths}${points}<text x="48" y="238">older</text><text x="612" y="238">current PR</text><text x="8" y="48">${maxValue.toFixed(0)} ms</text></svg><ul class="legend">${legend}</ul><table><thead><tr><th>Benchmark</th><th>p50</th><th>p95</th><th>p95 budget</th></tr></thead><tbody>${rows}</tbody></table></section>`
}

const charts = await Promise.all(
  ['cli', 'worktree', 'docker'].map(category => chart(category as BenchmarkResult['category']))
)
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Port benchmark PR preview</title>
<style>
body { background: #0f172a; color: #e2e8f0; font: 16px system-ui, sans-serif; margin: 0 auto; max-width: 900px; padding: 32px; }
h1 { margin-bottom: 4px; } p { color: #94a3b8; } section { background: #172033; border: 1px solid #334155; border-radius: 10px; margin-top: 24px; padding: 20px; } svg { background: #0f172a; border-radius: 6px; width: 100%; } .legend { display: flex; flex-wrap: wrap; gap: 12px; list-style: none; padding: 0; } .legend span { border-radius: 50%; display: inline-block; height: 10px; margin-right: 6px; width: 10px; } table { border-collapse: collapse; width: 100%; } td, th { border-top: 1px solid #334155; padding: 8px; text-align: left; } th { color: #94a3b8; }
</style>
</head>
<body>
<h1>Port benchmark PR preview</h1>
<p>The rightmost point is this PR and is not persisted until merge. Values are p50 command latency.</p>
${charts.join('\n')}
</body>
</html>
`

await mkdir(resolve(outputFile, '..'), { recursive: true })
await writeFile(resolve(outputFile), html)

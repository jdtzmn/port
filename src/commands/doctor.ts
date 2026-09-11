import chalk from 'chalk'
import {
  assertDoctorHealthy,
  collectDoctorReport,
  type DoctorCheck,
  type DoctorStatus,
} from '../lib/doctor.ts'
import * as output from '../lib/output.ts'

const STATUS_SYMBOL: Record<DoctorStatus, string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
  info: '•',
}

function colorStatus(status: DoctorStatus, value: string): string {
  if (status === 'pass') return chalk.green(value)
  if (status === 'warn') return chalk.yellow(value)
  if (status === 'fail') return chalk.red(value)
  return chalk.dim(value)
}

function printCheck(result: DoctorCheck): void {
  console.error(`  ${colorStatus(result.status, STATUS_SYMBOL[result.status])} ${result.summary}`)
  if (result.remediation && result.status !== 'pass' && result.status !== 'info') {
    console.error(chalk.dim(`    ${result.remediation}`))
  }
}

function printContext(report: Awaited<ReturnType<typeof collectDoctorReport>>): void {
  output.header('Port doctor')
  if (report.context.repoRoot) console.error(`Repo:      ${report.context.repoRoot}`)
  if (report.context.worktree) console.error(`Worktree:  ${report.context.worktree}`)
  if (report.context.domain) console.error(`Domain:    ${report.context.domain}`)
  if (!report.context.projectDetected) console.error(chalk.dim('Project:   Not detected'))
  output.newline()
}

function printGroup(title: string, checks: DoctorCheck[]): void {
  if (checks.length === 0) return
  output.header(title)
  for (const result of checks) printCheck(result)
  output.newline()
}

/** Diagnose Port prerequisites and configuration without modifying any state. */
export async function doctor(options: { verbose?: boolean } = {}): Promise<void> {
  const report = await collectDoctorReport()
  printContext(report)

  printGroup(
    'Prerequisites',
    report.checks.filter(result => result.category === 'prerequisites')
  )

  const attention = report.checks.filter(result => result.status === 'warn')
  const blockers = report.checks.filter(result => result.status === 'fail')
  if (options.verbose) {
    for (const [title, category] of [
      ['Routing', 'routing'],
      ['Local domains', 'domains'],
      ['Project', 'project'],
      ['State', 'state'],
    ] as const) {
      printGroup(
        title,
        report.checks.filter(result => result.category === category)
      )
    }
  } else {
    printGroup('Needs attention', attention)
    printGroup('Blockers', blockers)
  }

  if (blockers.length === 0 && attention.length === 0) {
    output.success('Port is ready.')
  }

  assertDoctorHealthy(report)
}

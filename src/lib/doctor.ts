import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { Registry } from '../types.ts'
import { CliError } from './cli.ts'
import { getComposeFile, configExists, loadConfig } from './config.ts'
import { isTraefikRunning } from './compose.ts'
import { checkDns } from './dns.ts'
import { execAsync } from './exec.ts'
import { isProcessRunning } from './hostService.ts'
import { REGISTRY_FILE } from './registry.ts'
import { getStaleWorktreeCandidates, STALE_WORKTREE_WARNING_THRESHOLD } from './staleWorktrees.ts'
import { loadTraefikConfig, traefikFilesExist } from './traefik.ts'
import { detectWorktree } from './worktree.ts'

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'info'

export interface DoctorCheck {
  id: string
  category: 'prerequisites' | 'routing' | 'domains' | 'project' | 'state'
  status: DoctorStatus
  summary: string
  remediation?: string
}

export interface DoctorContext {
  repoRoot?: string
  worktree?: string
  domain?: string
  projectDetected: boolean
}

export interface DoctorReport {
  context: DoctorContext
  checks: DoctorCheck[]
}

function check(
  id: DoctorCheck['id'],
  category: DoctorCheck['category'],
  status: DoctorStatus,
  summary: string,
  remediation?: string
): DoctorCheck {
  return { id, category, status, summary, remediation }
}

function hasValidRegistry(value: unknown): value is Registry {
  if (typeof value !== 'object' || value === null) return false
  const registry = value as Partial<Registry>
  return (
    Array.isArray(registry.projects) &&
    (registry.hostServices === undefined || Array.isArray(registry.hostServices))
  )
}

async function readRegistry(): Promise<{ registry?: Registry; check: DoctorCheck }> {
  if (!existsSync(REGISTRY_FILE)) {
    return {
      check: check('registry', 'state', 'info', 'No global Port state has been created yet.'),
    }
  }

  try {
    const parsed = JSON.parse(await readFile(REGISTRY_FILE, 'utf-8')) as unknown
    if (!hasValidRegistry(parsed)) {
      return {
        check: check(
          'registry',
          'state',
          'fail',
          'Global Port registry is malformed.',
          'Remove or repair ~/.port/registry.json after stopping Port services.'
        ),
      }
    }
    return {
      registry: parsed,
      check: check('registry', 'state', 'pass', 'Global Port registry is valid.'),
    }
  } catch {
    return {
      check: check(
        'registry',
        'state',
        'fail',
        'Global Port registry cannot be read.',
        'Remove or repair ~/.port/registry.json after stopping Port services.'
      ),
    }
  }
}

async function checkDocker(): Promise<DoctorCheck> {
  try {
    await execAsync('docker info', { timeout: 5000 })
    return check('docker', 'prerequisites', 'pass', 'Docker is running.')
  } catch {
    return check(
      'docker',
      'prerequisites',
      'fail',
      'Docker is not available.',
      'Start Docker, then retry.'
    )
  }
}

async function checkCompose(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execAsync('docker compose version --short', { timeout: 5000 })
    const version = stdout.trim()
    if (!version) throw new Error('No version')
    return check('compose', 'prerequisites', 'pass', `Docker Compose ${version}.`)
  } catch {
    return check(
      'compose',
      'prerequisites',
      'fail',
      'Docker Compose v2 is not available.',
      'Install Docker Compose v2.24.0 or newer, then retry.'
    )
  }
}

function checkHostServices(registry: Registry | undefined): DoctorCheck {
  const stale = (registry?.hostServices ?? []).filter(service => !isProcessRunning(service.pid))
  if (stale.length === 0) {
    return check('host-services', 'state', 'pass', 'No stale host processes found.')
  }
  return check(
    'host-services',
    'state',
    'warn',
    `${stale.length} stale host process${stale.length === 1 ? '' : 'es'} found.`,
    'Run `port kill <port>` from the owning worktree, then rerun the service with `port run`.'
  )
}

async function checkRouting(registry: Registry | undefined): Promise<DoctorCheck[]> {
  const routeCount = (registry?.projects.length ?? 0) + (registry?.hostServices?.length ?? 0)
  if (routeCount === 0) {
    return [check('traefik', 'routing', 'info', 'No active Port routes are registered.')]
  }

  const [running, filesExist, config] = await Promise.all([
    isTraefikRunning(),
    Promise.resolve(traefikFilesExist()),
    loadTraefikConfig(),
  ])
  const checks: DoctorCheck[] = []

  if (!running) {
    checks.push(
      check(
        'traefik',
        'routing',
        'fail',
        'Traefik is not running while Port routes are registered.',
        'Start the owning worktree with `port up`, then retry.'
      )
    )
  } else {
    checks.push(check('traefik', 'routing', 'pass', 'Traefik is running.'))
  }

  if (!filesExist || !config?.entryPoints?.web) {
    checks.push(
      check(
        'traefik-config',
        'routing',
        'fail',
        'Traefik configuration is incomplete.',
        'Run `port up` from an owning worktree to regenerate routing configuration.'
      )
    )
    return checks
  }

  const requiredPorts = new Set([
    ...registry!.projects.flatMap(project => project.ports),
    ...(registry!.hostServices ?? []).map(service => service.logicalPort),
  ])
  const missingPorts = [...requiredPorts].filter(port => !config.entryPoints[`port${port}`])
  if (missingPorts.length > 0) {
    checks.push(
      check(
        'entrypoints',
        'routing',
        'fail',
        `Traefik is missing entrypoints for ${missingPorts.join(', ')}.`,
        'Run `port up` from an owning worktree to update Traefik.'
      )
    )
  } else {
    checks.push(
      check('entrypoints', 'routing', 'pass', 'Required Traefik entrypoints are configured.')
    )
  }
  return checks
}

async function collectProjectChecks(context: DoctorContext): Promise<DoctorCheck[]> {
  if (!context.repoRoot) return [check('project', 'project', 'info', 'No Git repository detected.')]
  if (!configExists(context.repoRoot)) {
    return [
      check(
        'project',
        'project',
        'info',
        'No Port project configuration found in this repository.',
        'Run `port init` to create .port/config.jsonc.'
      ),
    ]
  }

  try {
    const config = await loadConfig(context.repoRoot)
    context.domain = config.domain
    const composeFile = getComposeFile(config)
    const checks: DoctorCheck[] = [
      check('project-config', 'project', 'pass', '.port/config.jsonc is valid.'),
    ]

    if (!existsSync(join(context.repoRoot, composeFile))) {
      checks.push(
        check(
          'compose-file',
          'project',
          'fail',
          `Compose file not found: ${composeFile}.`,
          'Update the `compose` setting or add the configured Compose file.'
        )
      )
    } else {
      checks.push(check('compose-file', 'project', 'pass', `Compose file found: ${composeFile}.`))
    }

    const dnsOk = await checkDns(config.domain)
    checks.push(
      dnsOk
        ? check('dns', 'domains', 'pass', `*.${config.domain} resolves locally.`)
        : check(
            'dns',
            'domains',
            'fail',
            `*.${config.domain} does not resolve locally.`,
            `Run \`port install --domain ${config.domain}\`, then retry.`
          )
    )
    return checks
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Port configuration.'
    return [
      check('project-config', 'project', 'fail', message, 'Repair .port/config.jsonc, then retry.'),
    ]
  }
}

async function checkStaleWorktrees(repoRoot: string | undefined): Promise<DoctorCheck> {
  if (!repoRoot)
    return check(
      'stale-worktrees',
      'state',
      'info',
      'No repository available to inspect worktrees.'
    )
  const stale = await getStaleWorktreeCandidates(repoRoot)
  if (stale.length < STALE_WORKTREE_WARNING_THRESHOLD) {
    return check('stale-worktrees', 'state', 'pass', 'No excessive stale worktrees found.')
  }
  return check(
    'stale-worktrees',
    'state',
    'warn',
    `${stale.length} stale worktrees found.`,
    'Review them with `port prune --dry-run`.'
  )
}

/** Collect read-only diagnostics without creating or cleaning up any Port state. */
export async function collectDoctorReport(): Promise<DoctorReport> {
  const context: DoctorContext = { projectDetected: false }
  try {
    const worktree = detectWorktree()
    context.repoRoot = worktree.repoRoot
    context.worktree = worktree.name
    context.projectDetected = configExists(worktree.repoRoot)
  } catch {
    // Global checks remain useful outside a Git repository.
  }

  const [docker, compose, registryResult, projectChecks, staleWorktrees] = await Promise.all([
    checkDocker(),
    checkCompose(),
    readRegistry(),
    collectProjectChecks(context),
    checkStaleWorktrees(context.repoRoot),
  ])
  const [routingChecks] = await Promise.all([checkRouting(registryResult.registry)])

  return {
    context,
    checks: [
      docker,
      compose,
      ...projectChecks,
      registryResult.check,
      ...routingChecks,
      checkHostServices(registryResult.registry),
      staleWorktrees,
    ],
  }
}

export function assertDoctorHealthy(report: DoctorReport): void {
  if (report.checks.some(result => result.status === 'fail')) {
    throw new CliError('', { exitCode: 1, alreadyReported: true })
  }
}

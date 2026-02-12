import * as output from '../lib/output.ts'
import { detectWorktree } from '../lib/worktree.ts'
import { failWithError } from '../lib/cli.ts'
import { loadConfig } from '../lib/config.ts'
import { listTaskAdapters, resolveTaskAdapter } from '../lib/taskAdapterRegistry.ts'

function getRepoRootOrFail(): string {
  try {
    return detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }
}

export async function remoteAdapters(): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const config = await loadConfig(repoRoot)
  const configured = config.remote?.adapter ?? 'local'

  output.header('Task adapters:')
  output.newline()

  for (const adapter of listTaskAdapters()) {
    const marker = adapter.id === configured ? ' (configured)' : ''
    output.info(`${adapter.id}${marker}`)
    output.dim(`  kind=${adapter.kind} · ${adapter.description}`)
    output.dim(
      `  caps: checkpoint=${adapter.capabilities.supportsCheckpoint}, restore=${adapter.capabilities.supportsRestore}, attach=${adapter.capabilities.supportsAttachHandoff}`
    )
  }
}

export async function remoteStatus(): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const scriptPath = process.argv[1]
  if (!scriptPath) {
    failWithError('Unable to resolve CLI entrypoint for adapter status')
  }

  const resolved = await resolveTaskAdapter(repoRoot, scriptPath)

  output.header('Remote status:')
  output.newline()
  output.info(`Configured adapter: ${resolved.configuredId}`)
  output.info(`Resolved adapter: ${resolved.resolvedId}`)
  output.info(`Fallback used: ${resolved.fallbackUsed ? 'yes' : 'no'}`)
}

export async function remoteDoctor(): Promise<void> {
  const repoRoot = getRepoRootOrFail()
  const scriptPath = process.argv[1]
  if (!scriptPath) {
    failWithError('Unable to resolve CLI entrypoint for adapter doctor checks')
  }

  const config = await loadConfig(repoRoot)
  const configured = config.remote?.adapter ?? 'local'
  const knownAdapters = new Set(listTaskAdapters().map(adapter => adapter.id))

  if (!knownAdapters.has(configured)) {
    output.error(`Configured adapter "${configured}" is unknown`)
    output.info('Fix .port/config.jsonc -> remote.adapter or run with default local adapter')
    process.exit(1)
  }

  const resolved = await resolveTaskAdapter(repoRoot, scriptPath)
  if (resolved.resolvedId === 'stub-remote') {
    output.warn('stub-remote is a contract stub and will not execute task workers yet')
  }

  output.success('Remote configuration looks healthy')
}

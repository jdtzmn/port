import { detectWorktree } from '../lib/worktree.ts'
import {
  hookExists,
  runHook,
  HOOK_NAMES,
  canRunHookInContext,
  type HookName,
} from '../lib/hooks.ts'
import { configExists, loadConfig } from '../lib/config.ts'
import { CliError, failWithError } from '../lib/cli.ts'
import * as output from '../lib/output.ts'

/**
 * Check if a string is a valid hook name
 */
function isValidHookName(name: string): name is HookName {
  return (HOOK_NAMES as string[]).includes(name)
}

/**
 * List available hooks and their status
 */
async function listHooks(repoRoot: string): Promise<void> {
  output.header('Available hooks:')
  output.newline()

  for (const name of HOOK_NAMES) {
    const exists = await hookExists(repoRoot, name)
    if (exists) {
      output.info(`${name} ${output.command('.port/hooks/' + name + '.sh')}`)
    } else {
      output.dim(`  ${name} (not configured)`)
    }
  }
}

/**
 * Re-run a hook script in the current worktree
 */
export async function hook(
  hookName: string | undefined,
  options: { list?: boolean }
): Promise<void> {
  // Detect worktree context
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch {
    failWithError('Not in a git repository')
  }

  const { repoRoot, worktreePath, name, isMainRepo } = worktreeInfo

  // Handle --list
  if (options.list) {
    await listHooks(repoRoot)
    return
  }

  // Require a hook name
  if (!hookName) {
    output.error('Missing hook name')
    output.newline()
    await listHooks(repoRoot)
    throw new CliError('Missing hook name', { exitCode: 1, alreadyReported: true })
  }

  // Validate hook name
  if (!isValidHookName(hookName)) {
    output.error(`Unknown hook "${hookName}"`)
    output.newline()
    await listHooks(repoRoot)
    throw new CliError(`Unknown hook "${hookName}"`, { exitCode: 1, alreadyReported: true })
  }

  // Respect hook-specific run context policy
  if (!canRunHookInContext(hookName, isMainRepo)) {
    failWithError(`Hook "${hookName}" can only be run from inside a worktree.`)
  }

  let domain: string | undefined
  if (configExists(repoRoot)) {
    try {
      const config = await loadConfig(repoRoot)
      domain = config.domain
    } catch {
      // Best-effort: hooks can still run without PORT_DOMAIN
    }
  }

  // Check hook exists
  if (!(await hookExists(repoRoot, hookName))) {
    failWithError(
      `Hook "${hookName}" is not configured. Create an executable script at .port/hooks/${hookName}.sh`
    )
  }

  // Run the hook
  output.info(`Running ${hookName} hook...`)

  const result = await runHook(
    repoRoot,
    hookName,
    {
      PORT_ROOT_PATH: repoRoot,
      PORT_WORKTREE_PATH: worktreePath,
      PORT_BRANCH: name,
      PORT_DOMAIN: domain,
    },
    name
  )

  if (!result.success) {
    output.error(`Hook "${hookName}" failed (exit code ${result.exitCode})`)
    output.dim('See .port/logs/latest.log for details')
    throw new CliError(`Hook "${hookName}" failed (exit code ${result.exitCode})`, {
      exitCode: result.exitCode,
      alreadyReported: true,
    })
  }

  output.success(`Hook "${hookName}" completed`)
}

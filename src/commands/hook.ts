import { detectWorktree } from '../lib/worktree.ts'
import { hookExists, runHook, HOOK_NAMES, type HookName } from '../lib/hooks.ts'
import { failWithError } from '../lib/cli.ts'
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
      output.success(`${name} ${output.command('.port/hooks/' + name + '.sh')}`)
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
    process.exit(1)
  }

  // Validate hook name
  if (!isValidHookName(hookName)) {
    output.error(`Unknown hook "${hookName}"`)
    output.newline()
    await listHooks(repoRoot)
    process.exit(1)
  }

  // Must be in a worktree
  if (isMainRepo) {
    failWithError('Must be inside a worktree to run hooks. Use `port enter <branch>` first.')
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
    },
    name
  )

  if (!result.success) {
    output.error(`Hook "${hookName}" failed (exit code ${result.exitCode})`)
    output.dim('See .port/logs/latest.log for details')
    process.exit(1)
  }

  output.success(`Hook "${hookName}" completed`)
}

import { spawn } from 'child_process'
import { detectWorktree, getWorktreePath, worktreeExists } from '../lib/worktree.ts'
import { loadConfig, configExists, getTreesDir, getComposeFile } from '../lib/config.ts'
import { createWorktree, removeWorktree } from '../lib/git.ts'
import { writeOverrideFile, parseComposeFile, getProjectName } from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import { hookExists, runPostCreateHook } from '../lib/hooks.ts'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import * as output from '../lib/output.ts'

interface EnterOptions {
  noShell?: boolean
}

/**
 * Enter a worktree (create if needed) and spawn a subshell
 *
 * @param branch - The branch name to enter
 * @param options - Enter options
 */
export async function enter(branch: string, options?: EnterOptions): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    output.error('Not in a git repository')
    process.exit(1)
  }

  // Check if port is initialized
  if (!configExists(repoRoot)) {
    output.error('Port not initialized. Run "port init" first.')
    process.exit(1)
  }

  // Load config
  const config = await loadConfig(repoRoot)

  // Sanitize branch name
  const sanitized = sanitizeBranchName(branch)
  if (sanitized !== branch) {
    output.dim(`Branch name sanitized: ${branch} → ${sanitized}`)
  }

  // Ensure trees directory exists
  const treesDir = getTreesDir(repoRoot)
  if (!existsSync(treesDir)) {
    await mkdir(treesDir, { recursive: true })
  }

  // Check if worktree exists, create if not
  let worktreePath: string

  // Track whether this is a new worktree (for running post-create hook)
  let isNewWorktree = false

  if (worktreeExists(repoRoot, branch)) {
    worktreePath = getWorktreePath(repoRoot, branch)
    output.dim(`Using existing worktree: ${sanitized}`)
  } else {
    output.info(`Creating worktree for branch: ${sanitized}`)
    try {
      worktreePath = await createWorktree(repoRoot, branch)
      isNewWorktree = true
      output.success(`Created worktree: ${sanitized}`)
    } catch (error) {
      output.error(`Failed to create worktree: ${error}`)
      process.exit(1)
    }
  }

  // Run post-create hook for new worktrees
  if (isNewWorktree && (await hookExists(repoRoot, 'post-create'))) {
    output.info('Running post-create hook...')

    const result = await runPostCreateHook({
      repoRoot,
      worktreePath,
      branch: sanitized,
    })

    if (!result.success) {
      output.error(`Post-create hook failed (exit code ${result.exitCode})`)
      output.dim('See .port/logs/latest.log for details')

      // Cleanup: remove the worktree
      output.info('Cleaning up worktree...')
      try {
        await removeWorktree(repoRoot, branch, true) // force=true
        output.dim('Worktree removed')
      } catch (cleanupError) {
        output.warn(`Failed to cleanup worktree: ${cleanupError}`)
      }

      process.exit(1)
    }

    output.success('Post-create hook completed')
  }

  // Parse docker-compose file and generate override file
  const composeFile = getComposeFile(config)
  try {
    const parsedCompose = await parseComposeFile(worktreePath, composeFile)
    const projectName = getProjectName(repoRoot, sanitized)
    await writeOverrideFile(worktreePath, parsedCompose, sanitized, config.domain, projectName)
    output.success('Generated .port/override.yml')
  } catch (error) {
    // It's okay if compose parsing fails here - the file might not exist yet in the worktree
    output.dim('Could not generate .port/override.yml (compose file may not exist yet)')
  }

  // Skip subshell if --no-shell flag is passed
  if (options?.noShell) {
    return
  }

  // Show service URLs
  output.newline()
  output.success(`Entered worktree: ${output.branch(sanitized)}`)

  output.newline()
  output.info(`Run ${output.command("'port up'")} to start services`)
  output.info("Type 'exit' to return to parent shell")
  output.newline()

  // Spawn subshell
  const shell = process.env.SHELL || '/bin/bash'

  const child = spawn(shell, [], {
    cwd: worktreePath,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT_WORKTREE: sanitized,
      PORT_REPO: repoRoot,
    },
  })

  // Wait for shell to exit
  child.on('exit', code => {
    output.newline()
    output.dim(`Exited worktree: ${sanitized}`)
    process.exit(code ?? 0)
  })

  child.on('error', error => {
    output.error(`Failed to spawn shell: ${error}`)
    process.exit(1)
  })
}

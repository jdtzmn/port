import { spawn } from 'child_process'
import { detectWorktree, getWorktreePath, worktreeExists } from '../lib/worktree.ts'
import { loadConfig, configExists, getTreesDir, getComposeFile } from '../lib/config.ts'
import { branchExists, createWorktree, remoteBranchExists, removeWorktree } from '../lib/git.ts'
import { writeOverrideFile, parseComposeFile, getProjectName } from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import { hookExists, runPostCreateHook } from '../lib/hooks.ts'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import inquirer from 'inquirer'
import * as output from '../lib/output.ts'
import { findSimilarCommand } from '../lib/commands.ts'
import { buildEnterCommands, getEvalContext, writeEvalFile } from '../lib/shell.ts'

/**
 * Enter a worktree (create if needed).
 *
 * When the shell hook is active (__PORT_EVAL env var), writes shell commands
 * (cd, export) to the eval file for the hook to pick up.
 * Otherwise, does setup work and prints a human-readable hint.
 *
 * @param branch - The branch name to enter
 */
export async function enter(branch: string): Promise<void> {
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
    const localBranch = await branchExists(repoRoot, branch)
    const remoteBranch = localBranch ? false : await remoteBranchExists(repoRoot, branch)

    if (!localBranch && !remoteBranch) {
      const similarCommand = findSimilarCommand(branch)

      if (similarCommand) {
        output.warn(
          `"${branch}" looks similar to the "${similarCommand.command}" command. You are about to create a new branch.`
        )

        let shouldCreateBranch = true

        if (process.stdin.isTTY) {
          const response = await inquirer.prompt<{ createBranch: boolean }>([
            {
              type: 'confirm',
              name: 'createBranch',
              message: `Create new branch "${branch}" anyway?`,
              default: false,
            },
          ])
          shouldCreateBranch = response.createBranch
        } else {
          output.dim('Non-interactive terminal detected, skipping confirmation prompt')
        }

        if (!shouldCreateBranch) {
          const forwardedArgs = getForwardedArgs(branch)
          const suggestedCommand = ['port', similarCommand.command, ...forwardedArgs].join(' ')

          const runSuggestedCommand = await promptToRunSuggestedCommand(suggestedCommand)

          if (runSuggestedCommand) {
            await runCommand(similarCommand.command, forwardedArgs)
            return
          }

          output.info('Cancelled.')
          process.exit(1)
        }
      }
    }

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

  // If running inside the shell hook, write eval commands to the sideband file
  const evalCtx = getEvalContext()
  if (evalCtx) {
    const commands = buildEnterCommands(evalCtx.shell, worktreePath, sanitized, repoRoot)
    writeEvalFile(commands, evalCtx.evalFile)
    return
  }

  // Without shell integration — print human-readable output with hint
  output.newline()
  output.success(`Worktree ready: ${output.branch(sanitized)}`)
  output.newline()
  output.info(`Run: cd ${worktreePath}`)
  output.newline()
  output.dim('Tip: Add shell integration for automatic cd:')
  output.dim('  eval "$(port shell-hook bash)"   # in ~/.bashrc')
  output.dim('  eval "$(port shell-hook zsh)"    # in ~/.zshrc')
  output.dim('  port shell-hook fish | source    # in ~/.config/fish/config.fish')
}

function getForwardedArgs(branch: string): string[] {
  const argv = process.argv.slice(2)
  const branchIndex = argv.indexOf(branch)

  if (branchIndex === -1) {
    return argv
  }

  // Remove the branch name from forwarded args
  return [...argv.slice(0, branchIndex), ...argv.slice(branchIndex + 1)]
}

async function promptToRunSuggestedCommand(suggestedCommand: string): Promise<boolean> {
  const response = await inquirer.prompt<{ runSuggestedCommand: boolean }>([
    {
      type: 'confirm',
      name: 'runSuggestedCommand',
      message: `Run "${suggestedCommand}" instead?`,
      default: true,
    },
  ])

  return response.runSuggestedCommand
}

async function runCommand(command: string, args: string[]): Promise<void> {
  const scriptPath = process.argv[1]

  if (!scriptPath) {
    output.error('Could not determine CLI entry point')
    process.exit(1)
  }

  const child = spawn(process.execPath, [scriptPath, command, ...args], {
    stdio: 'inherit',
    env: process.env,
  })

  const exitCode = await new Promise<number>(resolve => {
    child.on('exit', code => {
      resolve(code ?? 0)
    })

    child.on('error', error => {
      output.error(`Failed to run suggested command: ${error}`)
      resolve(1)
    })
  })

  process.exit(exitCode)
}

import { spawn } from 'child_process'
import { findGitRoot, getWorktreePath, worktreeExists } from '../lib/worktree.ts'
import { loadConfig, configExists, getTreesDir } from '../lib/config.ts'
import { createWorktree } from '../lib/git.ts'
import { writeOverrideFile } from '../lib/compose.ts'
import { sanitizeBranchName } from '../lib/sanitize.ts'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import * as output from '../lib/output.ts'

/**
 * Enter a worktree (create if needed) and spawn a subshell
 *
 * @param branch - The branch name to enter
 */
export async function enter(branch: string): Promise<void> {
  // Find git root
  const repoRoot = findGitRoot(process.cwd())

  if (!repoRoot) {
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

  if (worktreeExists(repoRoot, branch)) {
    worktreePath = getWorktreePath(repoRoot, branch)
    output.dim(`Using existing worktree: ${sanitized}`)
  } else {
    output.info(`Creating worktree for branch: ${sanitized}`)
    try {
      worktreePath = await createWorktree(repoRoot, branch)
      output.success(`Created worktree: ${sanitized}`)
    } catch (error) {
      output.error(`Failed to create worktree: ${error}`)
      process.exit(1)
    }
  }

  // Generate override file
  try {
    await writeOverrideFile(worktreePath, config, sanitized)
    output.success('Generated docker-compose.override.yml')
  } catch (error) {
    output.error(`Failed to generate override file: ${error}`)
    process.exit(1)
  }

  // Show service URLs
  output.newline()
  output.success(`Entered worktree: ${output.branch(sanitized)}`)
  output.success('Services available at:')

  const serviceUrls: Array<{ name: string; urls: string[] }> = []
  for (const service of config.services) {
    const urls = service.ports.map(port => `http://${sanitized}.${config.domain}:${port}`)
    serviceUrls.push({ name: service.name, urls })
  }
  output.serviceUrls(serviceUrls)

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

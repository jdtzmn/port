import { existsSync } from 'fs'
import { join } from 'path'
import { detectWorktree } from '../lib/worktree.ts'
import { loadConfigOrDefault, getComposeFile, ensurePortRuntimeDir } from '../lib/config.ts'
import { runCompose, getProjectName, parseComposeFile, writeOverrideFile } from '../lib/compose.ts'
import * as output from '../lib/output.ts'

/**
 * Run an arbitrary docker compose command with automatic -f flags
 *
 * This allows running any docker compose command while automatically
 * including the project's compose file and the port override file.
 *
 * Implements fail-closed behavior: synchronizes override file before
 * executing docker compose. If sync fails, aborts without executing.
 *
 * @param args - Arguments to pass to docker compose
 */
export async function compose(args: string[]): Promise<void> {
  // Detect worktree info
  let worktreeInfo
  try {
    worktreeInfo = detectWorktree()
  } catch (error) {
    output.error(`${error}`)
    process.exit(1)
  }

  const { repoRoot, worktreePath, name } = worktreeInfo

  await ensurePortRuntimeDir(repoRoot)

  // Load config
  let config
  try {
    config = await loadConfigOrDefault(repoRoot)
  } catch (error) {
    output.error(`Failed to load config: ${error}`)
    process.exit(1)
  }

  const composeFile = getComposeFile(config)

  // Check if the compose file exists
  if (!existsSync(join(worktreePath, composeFile))) {
    output.error(`Compose file not found: ${composeFile}`)
    process.exit(1)
  }

  // Synchronize override file before execution (fail-closed)
  let parsedCompose
  try {
    parsedCompose = await parseComposeFile(worktreePath, composeFile)
  } catch (error) {
    output.error(`Failed to parse compose file: ${error}`)
    process.exit(1)
  }

  const projectName = getProjectName(repoRoot, name)

  try {
    await writeOverrideFile(worktreePath, parsedCompose, name, config.domain, projectName)
  } catch (error) {
    output.error(`Failed to write override file: ${error}`)
    process.exit(1)
  }

  // Run the compose command with automatic -p and -f flags
  const { exitCode } = await runCompose(worktreePath, composeFile, projectName, args, {
    repoRoot,
    branch: name,
    domain: config.domain,
  })
  process.exit(exitCode)
}

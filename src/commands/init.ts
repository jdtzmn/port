import { mkdir, writeFile, chmod } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { findGitRoot } from '../lib/worktree.ts'
import {
  PORT_DIR,
  CONFIG_FILE,
  TREES_DIR,
  HOOKS_DIR,
  POST_CREATE_HOOK,
  getPortDir,
  getConfigPath,
  getTreesDir,
} from '../lib/config.ts'
import { getHooksDir, getHookPath } from '../lib/hooks.ts'
import { checkDns } from '../lib/dns.ts'
import * as output from '../lib/output.ts'

/** Default config template */
const CONFIG_TEMPLATE = `{
  // Domain suffix - services available at <branch-name>.port
  "domain": "port",

  // Path to docker-compose file (default: docker-compose.yml)
  "compose": "docker-compose.yml"
}
`

/** .gitignore content for .port directory */
const GITIGNORE_CONTENT = `# Ignore worktrees (they're local only)
trees/

# Generated override file for main repo
override.yml

# Hook logs
logs/
`

/** Post-create hook template */
const POST_CREATE_HOOK_TEMPLATE = `#!/bin/bash
# Port post-create hook
# Runs automatically when a new worktree is created via \`port [branch]\`
#
# Available environment variables:
#   PORT_ROOT_PATH     - Absolute path to the main repository root
#   PORT_WORKTREE_PATH - Absolute path to the newly created worktree
#   PORT_BRANCH        - The branch name (sanitized)
#
# Exit with non-zero to abort worktree creation (worktree will be removed)
#
# Example: Symlink .env from root to worktree (stays in sync)
#   ln -s "$PORT_ROOT_PATH/.env" "$PORT_WORKTREE_PATH/.env"

# Uncomment and customize below:
# echo "Setting up worktree for $PORT_BRANCH..."
# ln -s "$PORT_ROOT_PATH/.env" "$PORT_WORKTREE_PATH/.env"
# cd "$PORT_WORKTREE_PATH" && npm install
`

/**
 * Initialize .port directory in the current project
 */
export async function init(): Promise<void> {
  // Find git root
  const repoRoot = findGitRoot(process.cwd())

  if (!repoRoot) {
    output.error('Not in a git repository')
    process.exit(1)
  }

  const portDir = getPortDir(repoRoot)
  const configPath = getConfigPath(repoRoot)
  const treesDir = getTreesDir(repoRoot)
  const gitignorePath = join(portDir, '.gitignore')

  // Check if already initialized
  if (existsSync(portDir)) {
    output.warn(`${PORT_DIR}/ directory already exists`)
  } else {
    // Create .port directory
    await mkdir(portDir, { recursive: true })
    output.success(`Created ${PORT_DIR}/ directory`)
  }

  // Create trees directory
  if (!existsSync(treesDir)) {
    await mkdir(treesDir, { recursive: true })
    output.success(`Created ${PORT_DIR}/${TREES_DIR}/ directory`)
  }

  // Create hooks directory and post-create hook template
  const hooksDir = getHooksDir(repoRoot)
  const postCreateHookPath = getHookPath(repoRoot, 'post-create')

  if (!existsSync(hooksDir)) {
    await mkdir(hooksDir, { recursive: true })
    output.success(`Created ${PORT_DIR}/${HOOKS_DIR}/ directory`)
  }

  if (!existsSync(postCreateHookPath)) {
    await writeFile(postCreateHookPath, POST_CREATE_HOOK_TEMPLATE)
    await chmod(postCreateHookPath, 0o755) // Make executable
    output.success(`Created ${PORT_DIR}/${HOOKS_DIR}/${POST_CREATE_HOOK}`)
  } else {
    output.dim(`${PORT_DIR}/${HOOKS_DIR}/${POST_CREATE_HOOK} already exists`)
  }

  // Create config file if it doesn't exist
  if (!existsSync(configPath)) {
    await writeFile(configPath, CONFIG_TEMPLATE)
    output.success(`Created ${PORT_DIR}/${CONFIG_FILE}`)
  } else {
    output.dim(`${PORT_DIR}/${CONFIG_FILE} already exists`)
  }

  // Create .gitignore if it doesn't exist
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, GITIGNORE_CONTENT)
    output.success(`Created ${PORT_DIR}/.gitignore`)
  }

  // Check DNS configuration
  output.newline()
  const dnsConfigured = await checkDns()

  if (dnsConfigured) {
    output.success('DNS is configured for *.port domains')
  } else {
    output.warn('DNS not configured for *.port domains')
    output.info(`Run ${output.command("'port install'")} to set up DNS`)
  }

  output.newline()
  output.success('Initialization complete')
}

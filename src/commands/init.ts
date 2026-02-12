import { mkdir, writeFile, chmod } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { detectWorktree } from '../lib/worktree.ts'
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
import { failWithError } from '../lib/cli.ts'

/** Default config template */
const CONFIG_TEMPLATE = `{
  // Domain suffix - services available at <branch-name>.port
  "domain": "port",

  // Path to docker-compose file (default: docker-compose.yml)
  "compose": "docker-compose.yml",

  // Background task runtime settings (v2)
  "task": {
    // Daemon auto-stop timeout when idle
    "daemonIdleStopMinutes": 10,

    // Optional event subscribers (adapter-agnostic)
    "subscriptions": {
      "enabled": false,
      "consumers": ["opencode"]
    }
  },

  // Execution adapter settings (v2, remote-ready)
  "remote": {
    // Active adapter id
    "adapter": "local"
  }
}
`

/** .gitignore content for .port directory */
const GITIGNORE_CONTENT = `# Ignore worktrees (they're local only)
trees/

# Generated override file for main repo
override.yml
override.user.yml

# Hook logs
logs/

# Task runtime state and artifacts
jobs/
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

/** User compose override template */
const OVERRIDE_COMPOSE_TEMPLATE = `# Optional user compose overrides for Port.
#
# This file is read by Port and rendered at runtime into:
#   .port/override.user.yml
#
# Supported variables:
#   PORT_ROOT_PATH
#   PORT_WORKTREE_PATH
#   PORT_BRANCH
#   PORT_DOMAIN
#   PORT_PROJECT_NAME
#   PORT_COMPOSE_FILE
#
# Compose precedence (last file wins):
#   1) your base compose file
#   2) .port/override.yml (Port-generated)
#   3) .port/override.user.yml (rendered from this file)
#
# Add overrides below as needed. By default this file has no active changes.

# Example (disabled): add a branch label to web
# services:
#   web:
#     labels:
#       - app.branch=$PORT_BRANCH
#
# Example (disabled): branch-specific hostname rule
# services:
#   web:
#     labels:
#       - traefik.http.routers.$PORT_BRANCH-web.rule=Host(\`$PORT_BRANCH.$PORT_DOMAIN\`)
#
# Example (disabled): inject branch into container environment
# services:
#   web:
#     environment:
#       PORT_BRANCH_NAME: $PORT_BRANCH
`

/**
 * Initialize .port directory in the current project
 */
export async function init(): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }

  const portDir = getPortDir(repoRoot)
  const configPath = getConfigPath(repoRoot)
  const treesDir = getTreesDir(repoRoot)
  const gitignorePath = join(portDir, '.gitignore')
  const overrideComposePath = join(portDir, 'override-compose.yml')

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

  // Create user override compose template
  if (!existsSync(overrideComposePath)) {
    await writeFile(overrideComposePath, OVERRIDE_COMPOSE_TEMPLATE)
    output.success(`Created ${PORT_DIR}/override-compose.yml`)
  } else {
    output.dim(`${PORT_DIR}/override-compose.yml already exists`)
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

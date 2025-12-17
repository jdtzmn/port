import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { findGitRoot } from '../lib/worktree.ts'
import {
  PORT_DIR,
  CONFIG_FILE,
  TREES_DIR,
  getPortDir,
  getConfigPath,
  getTreesDir,
} from '../lib/config.ts'
import { checkDns } from '../lib/dns.ts'
import * as output from '../lib/output.ts'

/** Default config template */
const CONFIG_TEMPLATE = `{
  // Domain suffix - services available at <branch-name>.port
  "domain": "port",

  // Path to docker-compose file (default: docker-compose.yml)
  "compose": "docker-compose.yml",

  // List of services to expose via Traefik
  // Each service name must exist in docker-compose.yml
  "services": [
    {
      "name": "app",
      "ports": [3000]
    }
  ]
}
`

/** .gitignore content for .port directory */
const GITIGNORE_CONTENT = `# Ignore worktrees (they're local only)
trees/
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

  // Create config file if it doesn't exist
  if (!existsSync(configPath)) {
    await writeFile(configPath, CONFIG_TEMPLATE)
    output.success(`Created ${PORT_DIR}/${CONFIG_FILE}`)
    output.info(`Edit ${PORT_DIR}/${CONFIG_FILE} to configure your services`)
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

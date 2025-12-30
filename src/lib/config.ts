import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type { PortConfig } from '../types.ts'

/** Directory name for port configuration */
export const PORT_DIR = '.port'

/** Config file name */
export const CONFIG_FILE = 'config.jsonc'

/** Trees directory name (where worktrees live) */
export const TREES_DIR = 'trees'

/** Default domain suffix */
export const DEFAULT_DOMAIN = 'port'

/** Default docker-compose file */
export const DEFAULT_COMPOSE = 'docker-compose.yml'

/**
 * Error thrown when config validation fails
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Get the path to the .port directory for a given repo root
 */
export function getPortDir(repoRoot: string): string {
  return join(repoRoot, PORT_DIR)
}

/**
 * Get the path to the config file for a given repo root
 */
export function getConfigPath(repoRoot: string): string {
  return join(getPortDir(repoRoot), CONFIG_FILE)
}

/**
 * Get the path to the trees directory for a given repo root
 */
export function getTreesDir(repoRoot: string): string {
  return join(getPortDir(repoRoot), TREES_DIR)
}

/**
 * Check if a .port/config.jsonc file exists
 */
export function configExists(repoRoot: string): boolean {
  return existsSync(getConfigPath(repoRoot))
}

/**
 * Validate and normalize a port configuration
 */
function validateConfig(config: unknown): PortConfig {
  if (typeof config !== 'object' || config === null) {
    throw new ConfigError('Config must be an object')
  }

  const c = config as Record<string, unknown>

  // Validate domain (optional, defaults to 'port')
  let domain = DEFAULT_DOMAIN
  if (c.domain !== undefined) {
    if (typeof c.domain !== 'string' || c.domain.trim() === '') {
      throw new ConfigError('domain must be a non-empty string')
    }
    domain = c.domain.trim()
  }

  // Validate compose (optional, defaults to 'docker-compose.yml')
  let compose: string | undefined
  if (c.compose !== undefined) {
    if (typeof c.compose !== 'string' || c.compose.trim() === '') {
      throw new ConfigError('compose must be a non-empty string')
    }
    compose = c.compose.trim()
  }

  return {
    domain,
    compose,
  }
}

/**
 * Load and validate the .port/config.jsonc file
 *
 * @param repoRoot - The absolute path to the repo root
 * @returns The validated configuration
 * @throws ConfigError if the config is missing or invalid
 */
export async function loadConfig(repoRoot: string): Promise<PortConfig> {
  const configPath = getConfigPath(repoRoot)

  if (!existsSync(configPath)) {
    throw new ConfigError(
      `No ${PORT_DIR}/${CONFIG_FILE} found. Run 'port init' first or create the config manually.`
    )
  }

  const content = await readFile(configPath, 'utf-8')

  // Parse JSONC (allows comments)
  const errors: ParseError[] = []
  const config = parseJsonc(content, errors)

  if (errors.length > 0) {
    throw new ConfigError(`Invalid JSON in ${CONFIG_FILE}: ${JSON.stringify(errors[0])}`)
  }

  return validateConfig(config)
}

/**
 * Get the docker-compose file path for a config
 */
export function getComposeFile(config: PortConfig): string {
  return config.compose ?? DEFAULT_COMPOSE
}

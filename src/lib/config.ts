import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type { PortConfig, ServiceConfig } from '../types.ts'

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
 * Validate a service configuration
 */
function validateService(service: unknown, index: number): ServiceConfig {
  if (typeof service !== 'object' || service === null) {
    throw new ConfigError(`services[${index}] must be an object`)
  }

  const s = service as Record<string, unknown>

  if (typeof s.name !== 'string' || s.name.trim() === '') {
    throw new ConfigError(`services[${index}].name must be a non-empty string`)
  }

  if (!Array.isArray(s.ports)) {
    throw new ConfigError(`services[${index}].ports must be an array`)
  }

  if (s.ports.length === 0) {
    throw new ConfigError(`services[${index}].ports must have at least one port`)
  }

  for (let i = 0; i < s.ports.length; i++) {
    const port = s.ports[i]
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigError(`services[${index}].ports[${i}] must be a valid port number (1-65535)`)
    }
  }

  return {
    name: s.name.trim(),
    ports: s.ports as number[],
  }
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

  // Validate services (required)
  if (!Array.isArray(c.services)) {
    throw new ConfigError('services must be an array')
  }

  if (c.services.length === 0) {
    throw new ConfigError('services must have at least one service')
  }

  const services = c.services.map((s, i) => validateService(s, i))

  return {
    domain,
    compose,
    services,
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
 * Get all unique ports from a config
 */
export function getAllPorts(config: PortConfig): number[] {
  const ports = new Set<number>()
  for (const service of config.services) {
    for (const port of service.ports) {
      ports.add(port)
    }
  }
  return Array.from(ports).sort((a, b) => a - b)
}

/**
 * Get the docker-compose file path for a config
 */
export function getComposeFile(config: PortConfig): string {
  return config.compose ?? DEFAULT_COMPOSE
}

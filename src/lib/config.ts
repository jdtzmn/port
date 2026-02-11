import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type {
  PortConfig,
  PortTaskConfig,
  PortRemoteConfig,
  PortTaskAttachConfig,
} from '../types.ts'

const JSONC_PARSE_OPTIONS = {
  allowTrailingComma: true,
}

function parseConfigJsonc(content: string, errors: ParseError[]): unknown {
  return parseJsonc(content, errors, JSONC_PARSE_OPTIONS)
}

/** Directory name for port configuration */
export const PORT_DIR = '.port'

/** Config file name */
export const CONFIG_FILE = 'config.jsonc'

/** Trees directory name (where worktrees live) */
export const TREES_DIR = 'trees'

/** Hooks directory name */
export const HOOKS_DIR = 'hooks'

/** Logs directory name */
export const LOGS_DIR = 'logs'

/** Latest log file name */
export const LATEST_LOG = 'latest.log'

/** Post-create hook file name */
export const POST_CREATE_HOOK = 'post-create.sh'

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

  const task = validateTaskConfig(c.task)
  const remote = validateRemoteConfig(c.remote)

  return {
    domain,
    compose,
    task,
    remote,
  }
}

function validateTaskAttachConfig(value: unknown): PortTaskAttachConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'object' || value === null) {
    throw new ConfigError('task.attach must be an object')
  }

  const attach = value as Record<string, unknown>
  const out: PortTaskAttachConfig = {}

  if (attach.enabled !== undefined) {
    if (typeof attach.enabled !== 'boolean') {
      throw new ConfigError('task.attach.enabled must be a boolean')
    }
    out.enabled = attach.enabled
  }

  if (attach.client !== undefined) {
    if (typeof attach.client !== 'string' || attach.client.trim() === '') {
      throw new ConfigError('task.attach.client must be a non-empty string')
    }
    out.client = attach.client.trim()
  }

  if (attach.idleTimeoutMinutes !== undefined) {
    if (typeof attach.idleTimeoutMinutes !== 'number' || attach.idleTimeoutMinutes <= 0) {
      throw new ConfigError('task.attach.idleTimeoutMinutes must be a positive number')
    }
    out.idleTimeoutMinutes = attach.idleTimeoutMinutes
  }

  if (attach.reconnectGraceSeconds !== undefined) {
    if (typeof attach.reconnectGraceSeconds !== 'number' || attach.reconnectGraceSeconds <= 0) {
      throw new ConfigError('task.attach.reconnectGraceSeconds must be a positive number')
    }
    out.reconnectGraceSeconds = attach.reconnectGraceSeconds
  }

  return out
}

function validateTaskConfig(value: unknown): PortTaskConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'object' || value === null) {
    throw new ConfigError('task must be an object')
  }

  const task = value as Record<string, unknown>
  const out: PortTaskConfig = {}

  if (task.timeoutMinutes !== undefined) {
    if (typeof task.timeoutMinutes !== 'number' || task.timeoutMinutes <= 0) {
      throw new ConfigError('task.timeoutMinutes must be a positive number')
    }
    out.timeoutMinutes = task.timeoutMinutes
  }

  if (task.daemonIdleStopMinutes !== undefined) {
    if (typeof task.daemonIdleStopMinutes !== 'number' || task.daemonIdleStopMinutes <= 0) {
      throw new ConfigError('task.daemonIdleStopMinutes must be a positive number')
    }
    out.daemonIdleStopMinutes = task.daemonIdleStopMinutes
  }

  if (task.requireCleanApply !== undefined) {
    if (typeof task.requireCleanApply !== 'boolean') {
      throw new ConfigError('task.requireCleanApply must be a boolean')
    }
    out.requireCleanApply = task.requireCleanApply
  }

  if (task.lockMode !== undefined) {
    if (task.lockMode !== 'branch' && task.lockMode !== 'repo') {
      throw new ConfigError('task.lockMode must be "branch" or "repo"')
    }
    out.lockMode = task.lockMode
  }

  if (task.applyMethod !== undefined) {
    if (
      task.applyMethod !== 'auto' &&
      task.applyMethod !== 'cherry-pick' &&
      task.applyMethod !== 'bundle' &&
      task.applyMethod !== 'patch'
    ) {
      throw new ConfigError('task.applyMethod must be one of: auto, cherry-pick, bundle, patch')
    }
    out.applyMethod = task.applyMethod
  }

  out.attach = validateTaskAttachConfig(task.attach)
  return out
}

function validateRemoteConfig(value: unknown): PortRemoteConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'object' || value === null) {
    throw new ConfigError('remote must be an object')
  }

  const remote = value as Record<string, unknown>
  const out: PortRemoteConfig = {}

  if (remote.adapter !== undefined) {
    if (typeof remote.adapter !== 'string' || remote.adapter.trim() === '') {
      throw new ConfigError('remote.adapter must be a non-empty string')
    }
    out.adapter = remote.adapter.trim()
  }

  if (remote.adapters !== undefined) {
    if (
      typeof remote.adapters !== 'object' ||
      remote.adapters === null ||
      Array.isArray(remote.adapters)
    ) {
      throw new ConfigError('remote.adapters must be an object')
    }
    out.adapters = remote.adapters as Record<string, Record<string, unknown>>
  }

  return out
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
  const config = parseConfigJsonc(content, errors)

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

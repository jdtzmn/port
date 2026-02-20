/**
 * Project configuration stored in .port/config.jsonc
 */
export interface PortTaskAttachConfig {
  /** Reserve attach workflow toggle for v3 */
  enabled?: boolean
  /** Attach client selector/config key */
  client?: string
  /** Planned idle timeout while attached */
  idleTimeoutMinutes?: number
  /** Planned reconnect grace window */
  reconnectGraceSeconds?: number
}

export interface PortTaskSubscriptionsConfig {
  /** Toggle event subscriber dispatching */
  enabled?: boolean
  /** Subscriber ids to dispatch events to */
  consumers?: string[]
}

/** Supported worker types (single source of truth) */
export const WORKER_TYPES = ['opencode', 'mock'] as const
export type WorkerType = (typeof WORKER_TYPES)[number]

/** Supported adapter types (single source of truth) */
export const ADAPTER_TYPES = ['local', 'e2b'] as const
export type AdapterType = (typeof ADAPTER_TYPES)[number]

/** Config for an OpenCode worker instance */
export interface OpenCodeWorkerConfig {
  /** Model in provider/model format (e.g., "anthropic/claude-sonnet-4-20250514") */
  model?: string
  /** Path to the opencode binary (defaults to "opencode" on PATH) */
  binary?: string
  /** Additional CLI flags passed to opencode run */
  flags?: string[]
}

/** Config for a mock worker instance (testing) */
export interface MockWorkerConfig {
  /** Sleep duration in ms (overrides [sleep=N] title marker) */
  sleepMs?: number
  /** Force failure (overrides [fail] title marker) */
  shouldFail?: boolean
}

/** A named worker instance definition (discriminated union on `type`) */
export type WorkerDefinition =
  | { type: 'opencode'; adapter: AdapterType; config?: OpenCodeWorkerConfig }
  | { type: 'mock'; adapter: AdapterType; config?: MockWorkerConfig }

/** Config for a local adapter instance */
export interface LocalAdapterConfig {
  // No config needed for local execution (reserved for future use)
}

/** Config for an E2B remote adapter instance */
export interface E2bAdapterConfig {
  /** E2B API key (or use E2B_API_KEY env var) */
  apiKey?: string
  /** E2B sandbox template name */
  template?: string
}

/** A named adapter instance definition (discriminated union on `type`) */
export type AdapterDefinition =
  | { type: 'local'; config?: LocalAdapterConfig }
  | { type: 'e2b'; config?: E2bAdapterConfig }

export interface PortTaskConfig {
  /** Default task timeout */
  timeoutMinutes?: number
  /** Daemon idle auto-stop */
  daemonIdleStopMinutes?: number
  /** Clean tree required before apply */
  requireCleanApply?: boolean
  /** Optional branch-level lock mode */
  lockMode?: 'branch' | 'repo'
  /** Planned default apply method */
  applyMethod?: 'auto' | 'cherry-pick' | 'bundle' | 'patch'
  /** Forward-compatible attach config */
  attach?: PortTaskAttachConfig
  /** Event subscription dispatch config */
  subscriptions?: PortTaskSubscriptionsConfig
  /** Default worker instance name (references a key in workers) */
  defaultWorker?: string
  /** Named worker instances */
  workers?: Record<string, WorkerDefinition>
  /** Named adapter instances */
  adapters?: Record<string, AdapterDefinition>
}

export interface PortConfig {
  /** Domain suffix - services available at <branch-name>.<domain> (default: "port") */
  domain: string
  /** Path to docker-compose file (default: "docker-compose.yml") */
  compose?: string
  /** Task runtime/scheduler configuration */
  task?: PortTaskConfig
}

/**
 * Parsed port mapping from docker compose config
 */
export interface ParsedPort {
  /** Published (host) port - can be string or number depending on docker compose version */
  published: string | number
  /** Target (container) port */
  target: number
  /** Protocol (tcp/udp) */
  protocol?: string
}

/**
 * Parsed service from docker compose config --format json
 */
export interface ParsedComposeService {
  /** Container name (if explicitly set) */
  container_name?: string
  /** Image name */
  image?: string
  /** Build configuration */
  build?: object
  /** Port mappings */
  ports?: ParsedPort[]
  /** Networks */
  networks?: Record<string, object | null>
  /** Labels */
  labels?: Record<string, string>
}

/**
 * Parsed docker compose file from docker compose config --format json
 */
export interface ParsedComposeFile {
  /** Project name */
  name: string
  /** Services */
  services: Record<string, ParsedComposeService>
}

/**
 * A registered project in the global registry
 */
export interface Project {
  /** Absolute path to repo root */
  repo: string
  /** Sanitized branch/worktree name */
  branch: string
  /** All ports used by this project */
  ports: number[]
}

/**
 * A host service running on the machine (not in Docker)
 */
export interface HostService {
  /** Absolute path to repo root */
  repo: string
  /** Sanitized branch/worktree name */
  branch: string
  /** Port users access (e.g., 3000) */
  logicalPort: number
  /** Actual port the process listens on */
  actualPort: number
  /** Process ID of the running command */
  pid: number
  /** Path to the Traefik dynamic config file */
  configFile: string
}

/**
 * Global registry stored in ~/.port/registry.json
 */
export interface Registry {
  projects: Project[]
  hostServices?: HostService[]
}

/**
 * Result of worktree detection
 */
export interface WorktreeInfo {
  /** Absolute path to the git repo root (where .git is) */
  repoRoot: string
  /** Absolute path to the current worktree (may be same as repoRoot if in main repo) */
  worktreePath: string
  /** Name to use for routing (sanitized branch name or repo folder name) */
  name: string
  /** Whether we're in the main repo directory (not a worktree) */
  isMainRepo: boolean
}

/**
 * Traefik entrypoint configuration
 */
export interface TraefikEntrypoint {
  address: string
}

/**
 * Traefik static configuration
 */
export interface TraefikConfig {
  api: {
    dashboard: boolean
    insecure: boolean
  }
  providers: {
    docker: {
      exposedByDefault: boolean
      network: string
    }
    file?: {
      directory: string
      watch: boolean
    }
  }
  entryPoints: Record<string, TraefikEntrypoint>
}

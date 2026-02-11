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
}

export interface PortRemoteConfig {
  /** Active execution adapter */
  adapter?: string
  /** Adapter-specific config payload */
  adapters?: Record<string, Record<string, unknown>>
}

export interface PortConfig {
  /** Domain suffix - services available at <branch-name>.<domain> (default: "port") */
  domain: string
  /** Path to docker-compose file (default: "docker-compose.yml") */
  compose?: string
  /** Task runtime/scheduler configuration */
  task?: PortTaskConfig
  /** Remote adapter configuration */
  remote?: PortRemoteConfig
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

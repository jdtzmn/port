/**
 * Service configuration for a single docker-compose service
 */
export interface ServiceConfig {
  /** Service name in docker-compose.yml */
  name: string
  /** Ports to expose via Traefik */
  ports: number[]
}

/**
 * Project configuration stored in .port/config.jsonc
 */
export interface PortConfig {
  /** Domain suffix - services available at <branch-name>.<domain> (default: "port") */
  domain: string
  /** Path to docker-compose file (default: "docker-compose.yml") */
  compose?: string
  /** List of services to expose via Traefik */
  services: ServiceConfig[]
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
 * Global registry stored in ~/.port/registry.json
 */
export interface Registry {
  projects: Project[]
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
  }
  entryPoints: Record<string, TraefikEntrypoint>
}

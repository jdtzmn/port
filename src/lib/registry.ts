import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Registry, Project, HostService } from '../types.ts'

/** Optional env var to override global state directory (used by tests) */
const GLOBAL_PORT_DIR_ENV = 'PORT_GLOBAL_DIR'

/** Global port directory in user's home */
export const GLOBAL_PORT_DIR = process.env[GLOBAL_PORT_DIR_ENV]?.trim() || join(homedir(), '.port')

/** Registry file path */
export const REGISTRY_FILE = join(GLOBAL_PORT_DIR, 'registry.json')

/**
 * Ensure the global .port directory exists
 */
export async function ensureGlobalDir(): Promise<void> {
  if (!existsSync(GLOBAL_PORT_DIR)) {
    await mkdir(GLOBAL_PORT_DIR, { recursive: true })
  }
}

/**
 * Load the global registry
 * Creates an empty registry if it doesn't exist
 *
 * @returns The registry object
 */
export async function loadRegistry(): Promise<Registry> {
  await ensureGlobalDir()

  if (!existsSync(REGISTRY_FILE)) {
    return { projects: [], hostServices: [] }
  }

  try {
    const content = await readFile(REGISTRY_FILE, 'utf-8')
    const registry = JSON.parse(content) as Registry

    // Validate structure
    if (!Array.isArray(registry.projects)) {
      return { projects: [], hostServices: [] }
    }

    // Ensure hostServices array exists
    if (!Array.isArray(registry.hostServices)) {
      registry.hostServices = []
    }

    return registry
  } catch {
    // If file is corrupted, return empty registry
    return { projects: [], hostServices: [] }
  }
}

/**
 * Save the registry to disk
 *
 * @param registry - The registry to save
 */
export async function saveRegistry(registry: Registry): Promise<void> {
  await ensureGlobalDir()
  await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2))
}

/**
 * Register a project in the global registry
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 * @param ports - Ports used by this project
 */
export async function registerProject(
  repo: string,
  branch: string,
  ports: number[]
): Promise<void> {
  const registry = await loadRegistry()

  // Check if already registered
  const existing = registry.projects.find(p => p.repo === repo && p.branch === branch)

  if (existing) {
    // Update ports
    existing.ports = ports
  } else {
    // Add new project
    registry.projects.push({ repo, branch, ports })
  }

  await saveRegistry(registry)
}

/**
 * Unregister a project from the global registry
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 */
export async function unregisterProject(repo: string, branch: string): Promise<void> {
  const registry = await loadRegistry()

  registry.projects = registry.projects.filter(p => !(p.repo === repo && p.branch === branch))

  await saveRegistry(registry)
}

/**
 * Get a project from the registry
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 * @returns The project or undefined if not found
 */
export async function getProject(repo: string, branch: string): Promise<Project | undefined> {
  const registry = await loadRegistry()
  return registry.projects.find(p => p.repo === repo && p.branch === branch)
}

/**
 * Check if a project is registered
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 * @returns true if the project is registered
 */
export async function isProjectRegistered(repo: string, branch: string): Promise<boolean> {
  const project = await getProject(repo, branch)
  return project !== undefined
}

/**
 * Get all registered projects
 *
 * @returns Array of all registered projects
 */
export async function getAllProjects(): Promise<Project[]> {
  const registry = await loadRegistry()
  return registry.projects
}

/**
 * Get all unique ports used across all registered projects
 *
 * @returns Array of unique port numbers
 */
export async function getAllRegisteredPorts(): Promise<number[]> {
  const registry = await loadRegistry()
  const ports = new Set<number>()

  for (const project of registry.projects) {
    for (const port of project.ports) {
      ports.add(port)
    }
  }

  return Array.from(ports).sort((a, b) => a - b)
}

/**
 * Check if any projects are registered
 *
 * @returns true if there are registered projects
 */
export async function hasRegisteredProjects(): Promise<boolean> {
  const registry = await loadRegistry()
  return registry.projects.length > 0
}

/**
 * Get count of registered projects
 *
 * @returns Number of registered projects
 */
export async function getProjectCount(): Promise<number> {
  const registry = await loadRegistry()
  return registry.projects.length
}

// ============================================
// Host Service Registry Functions
// ============================================

/**
 * Register a host service in the global registry
 *
 * @param service - The host service to register
 */
export async function registerHostService(service: HostService): Promise<void> {
  const registry = await loadRegistry()

  if (!registry.hostServices) {
    registry.hostServices = []
  }

  // Check if already registered
  const existingIndex = registry.hostServices.findIndex(
    s =>
      s.repo === service.repo &&
      s.branch === service.branch &&
      s.logicalPort === service.logicalPort
  )

  if (existingIndex >= 0) {
    // Update existing
    registry.hostServices[existingIndex] = service
  } else {
    // Add new
    registry.hostServices.push(service)
  }

  await saveRegistry(registry)
}

/**
 * Unregister a host service from the global registry
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 * @param logicalPort - The logical port
 */
export async function unregisterHostService(
  repo: string,
  branch: string,
  logicalPort: number
): Promise<void> {
  const registry = await loadRegistry()

  if (!registry.hostServices) {
    return
  }

  registry.hostServices = registry.hostServices.filter(
    s => !(s.repo === repo && s.branch === branch && s.logicalPort === logicalPort)
  )

  await saveRegistry(registry)
}

/**
 * Get a host service from the registry
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 * @param logicalPort - The logical port
 * @returns The host service or undefined if not found
 */
export async function getHostService(
  repo: string,
  branch: string,
  logicalPort: number
): Promise<HostService | undefined> {
  const registry = await loadRegistry()
  return registry.hostServices?.find(
    s => s.repo === repo && s.branch === branch && s.logicalPort === logicalPort
  )
}

/**
 * Get all host services for a worktree
 *
 * @param repo - Absolute path to the repo root
 * @param branch - Sanitized branch/worktree name
 * @returns Array of host services
 */
export async function getHostServicesForWorktree(
  repo: string,
  branch: string
): Promise<HostService[]> {
  const registry = await loadRegistry()
  return registry.hostServices?.filter(s => s.repo === repo && s.branch === branch) ?? []
}

/**
 * Get all host services
 *
 * @returns Array of all host services
 */
export async function getAllHostServices(): Promise<HostService[]> {
  const registry = await loadRegistry()
  return registry.hostServices ?? []
}

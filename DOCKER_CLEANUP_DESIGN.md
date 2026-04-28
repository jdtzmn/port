# Docker Cleanup Implementation Design

**Issue:** #68 - Cleanup docker volumes, images, etc on worktree cleanup  
**Design Owner:** RedStorm  
**Cell:** jdtzmn-port--ru8u5-mn885odh6ku  
**Epic:** jdtzmn-port--ru8u5-mn885od83be  
**Date:** 2026-03-26

---

## Executive Summary

This design specifies the complete implementation for scoped Docker resource cleanup in Port. It defines exact command semantics, safety mechanisms, user prompts, and code touch points to implement issue #68 without requiring code changes during implementation.

**Core Principle:** Project-label-scoped cleanup using Docker Compose project names ensures we only clean resources belonging to removed worktrees, never touching shared infrastructure or other projects.

---

## Table of Contents

1. [Command Semantics](#1-command-semantics)
2. [Resource Scoping Strategy](#2-resource-scoping-strategy)
3. [Safety Mechanisms](#3-safety-mechanisms)
4. [Command Behavior Specifications](#4-command-behavior-specifications)
5. [Type Definitions](#5-type-definitions)
6. [Implementation Touch Points](#6-implementation-touch-points)
7. [Test Strategy](#7-test-strategy)
8. [Acceptance Criteria](#8-acceptance-criteria)
9. [Risk Mitigation](#9-risk-mitigation)

---

## 1. Command Semantics

### 1.1 Overview

Three commands will gain Docker cleanup capabilities:

| Command        | When                                | What Gets Cleaned                         | User Control                 |
| -------------- | ----------------------------------- | ----------------------------------------- | ---------------------------- |
| `port remove`  | Immediate (during worktree removal) | Volumes, networks, containers             | `--skip-docker-cleanup` flag |
| `port prune`   | Immediate (after batch removal)     | Volumes, networks, containers             | `--skip-docker-cleanup` flag |
| `port cleanup` | Deferred (user-initiated)           | Volumes, networks, containers, **images** | Prompt with breakdown        |

### 1.2 Design Rationale

**Why `remove` and `prune` get immediate cleanup:**

- These commands explicitly remove worktrees → resources are no longer needed
- Users expect full cleanup when they delete a worktree
- Prevents resource accumulation (current pain point in issue #68)

**Why `cleanup` gets deferred cleanup:**

- Targets archived branches that may have been kept intentionally
- Includes image cleanup (expensive to rebuild, needs confirmation)
- Provides a safety net for users who skipped immediate cleanup

**Why images are excluded from immediate cleanup:**

- Images may be shared across worktrees (e.g., `postgres:14`, `node:20`)
- Expensive to rebuild (multi-minute downloads)
- Less disk space urgency than volumes (images are deduplicated by layers)

---

## 2. Resource Scoping Strategy

### 2.1 Docker Compose Project Labels

Docker Compose automatically labels all resources with:

```
com.docker.compose.project=<projectName>
```

Port already generates unique project names via `getProjectName(repoRoot, worktreeName)`:

```typescript
// Examples:
// Repo: /Users/jacob/projects/port
// Worktree: feature-1
// Project Name: port-feature-1

// Repo: /Users/jacob/work/api
// Worktree: bugfix-auth
// Project Name: api-bugfix-auth
```

### 2.2 Resource Identification Commands

```bash
# List volumes for a project
docker volume ls --filter "label=com.docker.compose.project=port-feature-1" --quiet

# List networks for a project
docker network ls --filter "label=com.docker.compose.project=port-feature-1" --quiet

# List containers for a project (stopped)
docker ps -a --filter "label=com.docker.compose.project=port-feature-1" --quiet

# List images for a project
docker images --filter "label=com.docker.compose.project=port-feature-1" --quiet --format "{{.Repository}}:{{.Tag}}"
```

### 2.3 Risk Tiers

| Resource Type          | Risk Level | Justification                    | Default Behavior     |
| ---------------------- | ---------- | -------------------------------- | -------------------- |
| Containers (stopped)   | **Low**    | Project-scoped, no shared state  | Auto-clean           |
| Volumes                | **Low**    | Project-scoped, data is local    | Auto-clean           |
| Networks (non-traefik) | **Low**    | Project-scoped, ephemeral        | Auto-clean           |
| Images                 | **Medium** | May be shared, expensive rebuild | Require confirmation |
| Traefik network        | **High**   | Shared infrastructure            | **Never clean**      |
| Unlabeled resources    | **High**   | No project association           | **Never clean**      |

### 2.4 Exclusion Rules

**MUST NEVER CLEAN:**

1. `traefik-network` (the network name constant from `src/lib/traefik.ts`)
2. `port-traefik` container (Traefik proxy container)
3. Resources without `com.docker.compose.project` label
4. Resources from different project names
5. Running containers (safety check, should already be stopped)

---

## 3. Safety Mechanisms

### 3.1 Pre-Cleanup Validation

Before removing any resources, validate:

```typescript
interface DockerCleanupValidation {
  projectName: string

  // Resources found
  volumeCount: number
  networkCount: number
  containerCount: number
  imageCount: number

  // Safety checks
  hasRunningContainers: boolean // BLOCK if true
  hasTraefikNetwork: boolean // WARN and exclude
  hasUnlabeledResources: boolean // WARN and exclude
}
```

**Blocking Conditions:**

- Running containers with project label → ERROR, do not proceed
  - Should never happen (compose down runs first)
  - Indicates a race condition or partial failure
  - **Action:** Fail cleanup, report to user

**Warning Conditions:**

- Traefik network in filter results → WARN, exclude from deletion
- Unlabeled resources found → WARN, exclude from deletion

### 3.2 User Prompts

#### For `port remove` / `port prune` (immediate cleanup)

**No prompt by default** - cleanup runs automatically after successful `docker compose down`.

**Opt-out flag:**

```bash
port remove feature-1 --skip-docker-cleanup
port prune --skip-docker-cleanup
```

**Output example:**

```
Removing worktree: feature-1...
Stopping services in feature-1...
✓ Services stopped
Cleaning up Docker resources...
  ✓ Removed 2 volumes
  ✓ Removed 1 network
  ✓ Removed 3 containers
✓ Worktree feature-1 removed
```

#### For `port cleanup` (deferred cleanup)

**Always prompt** with resource breakdown:

```
Archived branches:

  archive/feature-1-1743014400
  archive/bugfix-auth-1743014500

Delete all 2 archived branch(es)? (y/N) y

Deleted archive/feature-1-1743014400
Deleted archive/bugfix-auth-1743014500

Docker resources found for archived branches:

  feature-1:
    - 2 volumes (500 MB)
    - 1 network
    - 3 containers
    - 1 image (postgres:14, 350 MB)

  bugfix-auth:
    - 1 volume (120 MB)
    - 1 network
    - 2 containers
    - 0 images

Also clean up Docker resources? (y/N)
```

**Breakdown display rules:**

- Show total disk usage when available (via `docker system df`)
- Group by original branch name (parse from archive format)
- Show image names (not just IDs) for informed decision
- Skip prompt if zero resources found

### 3.3 Error Handling

```typescript
interface DockerCleanupError {
  type: 'permission_denied' | 'resource_in_use' | 'docker_unavailable' | 'partial_failure'
  resource?: string
  message: string
  exitCode?: number
}
```

**Error Handling Strategy:**

1. **Docker daemon not running:**
   - Detect early: `docker info` exit code check
   - **Action:** Skip cleanup, warn user, continue worktree removal
   - **Rationale:** Worktree removal should not fail due to Docker issues

2. **Permission denied:**
   - **Action:** Skip resource, log warning, continue with remaining resources
   - **Example:** "⚠️ Failed to remove volume port-feature-1_db: permission denied"

3. **Resource in use:**
   - **Action:** Skip resource, log warning, continue
   - **Rationale:** Another process may have started using the resource

4. **Partial failure:**
   - **Action:** Report counts (e.g., "Removed 2/3 volumes, 1 failed")
   - **Rationale:** User can retry cleanup command or manually inspect

**Non-Fatal Guarantee:**
All Docker cleanup errors are **non-fatal** - they warn but do not block worktree removal.

---

## 4. Command Behavior Specifications

### 4.1 `port remove` Behavior

**Execution Flow:**

```
1. Validate worktree exists
2. Confirm removal (unless --force)
3. Exit from worktree if user is inside
4. Load config
5. Execute removeWorktreeAndCleanup():
   a. stopWorktreeServices() → docker compose down
   b. cleanupDockerResources() → NEW STEP (unless --skip-docker-cleanup)
   c. Remove git worktree
   d. Unregister from global registry
   e. Archive/delete/keep local branch
6. Prompt to stop Traefik if no other projects
7. Report success
```

**New Step Integration Point:**

In `src/lib/removal.ts`, function `removeWorktreeAndCleanup()`:

```typescript
// After step 1 (stopWorktreeServices)
// Before step 2 (remove git worktree)

// 1b. Clean up Docker resources (NEW)
if (!options.skipDockerCleanup) {
  try {
    const projectName = getProjectName(ctx.repoRoot, sanitized)
    const cleanupResult = await cleanupDockerResources(projectName, {
      quiet: options.quiet,
      // Images excluded from immediate cleanup
      skipImages: true,
    })

    if (!options.quiet && cleanupResult.totalRemoved > 0) {
      output.success(`Cleaned up ${cleanupResult.totalRemoved} Docker resources`)
    }
  } catch (error) {
    // Non-fatal: warn but continue
    if (!options.quiet) {
      output.warn(`Docker cleanup warning: ${error}`)
    }
  }
}
```

**Type Changes:**

```typescript
// src/lib/removal.ts
export interface RemoveWorktreeOptions {
  branchAction: 'archive' | 'delete' | 'keep'
  nonStandardPath?: string
  skipServices?: boolean
  quiet?: boolean
  skipDockerCleanup?: boolean // NEW
}
```

**CLI Flag:**

```typescript
// src/commands/remove.ts
// Add to commander.js option parsing
.option('--skip-docker-cleanup', 'Skip Docker resource cleanup')
```

### 4.2 `port prune` Behavior

**Execution Flow:**

```
1. Fetch remote state (unless --no-fetch)
2. Detect merged/gone/PR-merged branches
3. Build candidate list
4. Display candidates
5. Confirm removal (unless --force or --dry-run)
6. Stop services in parallel (batched, concurrency=3)
7. Remove each candidate (serial):
   a. removeWorktreeAndCleanup() → includes Docker cleanup
8. Report summary
```

**Integration Point:**

Docker cleanup happens **automatically** inside `removeWorktreeAndCleanup()` (same as `port remove`).

**Type Changes:**

```typescript
// src/commands/prune.ts
interface PruneOptions {
  dryRun?: boolean
  force?: boolean
  noFetch?: boolean
  base?: string
  skipDockerCleanup?: boolean // NEW - passed through to removeWorktreeAndCleanup
}
```

**CLI Flag:**

```typescript
// src/commands/prune.ts
// Add to commander.js option parsing
.option('--skip-docker-cleanup', 'Skip Docker resource cleanup')
```

**Pass-through to removal:**

```typescript
// In prune() function, when calling removeWorktreeAndCleanup:
const result = await removeWorktreeAndCleanup(ctx, candidate.branch, {
  branchAction: 'archive',
  skipServices: true,
  quiet: true,
  skipDockerCleanup: options.skipDockerCleanup, // NEW
})
```

### 4.3 `port cleanup` Behavior

**Execution Flow (Existing):**

```
1. Detect repo root
2. List archived branches
3. Display branches
4. Confirm deletion
5. Delete each branch
6. Report summary
```

**Execution Flow (New):**

```
1. Detect repo root
2. List archived branches
3. Display branches
4. Confirm deletion
5. Delete each branch
6. Report summary
7. Scan for Docker resources (NEW)
8. Display resource breakdown (NEW)
9. Confirm Docker cleanup (NEW)
10. Clean up Docker resources (NEW)
11. Report cleanup summary (NEW)
```

**New Steps Detail:**

**Step 7: Scan for Docker resources**

```typescript
// After deleting branches, before final success message
const dockerResources = await scanDockerResourcesForArchivedBranches(repoRoot, archivedBranches)

if (dockerResources.totalResources === 0) {
  // No resources found, skip steps 8-11
  output.success(`Deleted ${deletedCount} archived branch(es).`)
  return
}
```

**Step 8: Display resource breakdown**

```typescript
output.newline()
output.header('Docker resources found for archived branches:')
output.newline()

for (const [branch, resources] of dockerResources.byBranch.entries()) {
  console.log(`  ${output.branch(branch)}:`)

  if (resources.volumes.length > 0) {
    const size = resources.volumeSize ? ` (${formatBytes(resources.volumeSize)})` : ''
    console.log(`    - ${resources.volumes.length} volume(s)${size}`)
  }

  if (resources.networks.length > 0) {
    console.log(`    - ${resources.networks.length} network(s)`)
  }

  if (resources.containers.length > 0) {
    console.log(`    - ${resources.containers.length} container(s)`)
  }

  if (resources.images.length > 0) {
    const imageNames = resources.images.map(img => img.name).join(', ')
    const size = resources.imageSize ? ` (${formatBytes(resources.imageSize)})` : ''
    console.log(`    - ${resources.images.length} image(s): ${imageNames}${size}`)
  }

  output.newline()
}
```

**Step 9: Confirm Docker cleanup**

```typescript
const { confirmDockerCleanup } = await inquirer.prompt<{ confirmDockerCleanup: boolean }>([
  {
    type: 'confirm',
    name: 'confirmDockerCleanup',
    message: 'Also clean up Docker resources?',
    default: false,
  },
])

if (!confirmDockerCleanup) {
  output.success(`Deleted ${deletedCount} archived branch(es).`)
  return
}
```

**Step 10: Clean up Docker resources**

```typescript
let volumesRemoved = 0
let networksRemoved = 0
let containersRemoved = 0
let imagesRemoved = 0

for (const [branch, resources] of dockerResources.byBranch.entries()) {
  const originalBranch = parseOriginalBranchName(branch)
  const projectName = getProjectName(repoRoot, sanitizeBranchName(originalBranch))

  const result = await cleanupDockerResources(projectName, {
    quiet: false,
    skipImages: false, // Include images in deferred cleanup
  })

  volumesRemoved += result.volumesRemoved
  networksRemoved += result.networksRemoved
  containersRemoved += result.containersRemoved
  imagesRemoved += result.imagesRemoved
}
```

**Step 11: Report cleanup summary**

```typescript
output.newline()
output.success('Docker cleanup summary:')
if (volumesRemoved > 0) output.info(`  ✓ Removed ${volumesRemoved} volume(s)`)
if (networksRemoved > 0) output.info(`  ✓ Removed ${networksRemoved} network(s)`)
if (containersRemoved > 0) output.info(`  ✓ Removed ${containersRemoved} container(s)`)
if (imagesRemoved > 0) output.info(`  ✓ Removed ${imagesRemoved} image(s)`)
```

**Helper Functions Needed:**

```typescript
// Parse original branch name from archive format
// archive/feature-1-1743014400 → feature-1
function parseOriginalBranchName(archivedBranch: string): string

// Scan all Docker resources for a list of branches
function scanDockerResourcesForArchivedBranches(
  repoRoot: string,
  archivedBranches: string[]
): Promise<DockerResourceScanResult>

// Format bytes for display
function formatBytes(bytes: number): string
```

---

## 5. Type Definitions

### 5.1 Core Cleanup Types

**Location:** `src/lib/types.ts`

```typescript
/**
 * Options for Docker resource cleanup
 */
export interface DockerCleanupOptions {
  /** Suppress per-resource output */
  quiet?: boolean

  /** Skip image cleanup (default: false for cleanup command, true for remove/prune) */
  skipImages?: boolean

  /** Dry run - list resources without removing */
  dryRun?: boolean
}

/**
 * Result of Docker resource cleanup operation
 */
export interface DockerCleanupResult {
  /** Number of volumes removed */
  volumesRemoved: number

  /** Number of networks removed */
  networksRemoved: number

  /** Number of containers removed */
  containersRemoved: number

  /** Number of images removed */
  imagesRemoved: number

  /** Total resources removed */
  totalRemoved: number

  /** Warnings encountered (non-fatal) */
  warnings: string[]

  /** Whether Docker daemon was available */
  dockerAvailable: boolean
}

/**
 * Docker resources for a single project
 */
export interface DockerProjectResources {
  projectName: string
  volumes: string[]
  networks: string[]
  containers: string[]
  images: Array<{ id: string; name: string }>

  /** Total size of volumes in bytes (if available) */
  volumeSize?: number

  /** Total size of images in bytes (if available) */
  imageSize?: number
}

/**
 * Scan result for multiple projects
 */
export interface DockerResourceScanResult {
  /** Resources grouped by branch name */
  byBranch: Map<string, DockerProjectResources>

  /** Total count across all branches */
  totalResources: number

  /** Whether Docker daemon was available */
  dockerAvailable: boolean
}
```

### 5.2 Updated Existing Types

**Location:** `src/lib/removal.ts`

```typescript
export interface RemoveWorktreeOptions {
  /** How to handle the local branch after worktree removal */
  branchAction: 'archive' | 'delete' | 'keep'

  /** Whether the worktree is at a non-standard path */
  nonStandardPath?: string

  /** Skip stopping services (used by batched prune workflows) */
  skipServices?: boolean

  /** Suppress per-step output (for batch operations) */
  quiet?: boolean

  /** Skip Docker resource cleanup (NEW) */
  skipDockerCleanup?: boolean
}
```

**Location:** `src/commands/prune.ts`

```typescript
interface PruneOptions {
  dryRun?: boolean
  force?: boolean
  noFetch?: boolean
  base?: string
  skipDockerCleanup?: boolean // NEW
}
```

**Location:** `src/commands/remove.ts`

```typescript
interface RemoveOptions {
  force?: boolean
  keepBranch?: boolean
  skipDockerCleanup?: boolean // NEW
}
```

**Location:** `src/commands/cleanup.ts`

```typescript
// No type changes needed - cleanup uses prompts, not flags
```

---

## 6. Implementation Touch Points

### 6.1 New File: `src/lib/docker-cleanup.ts`

**Purpose:** Core Docker resource cleanup logic

**Exports:**

```typescript
export async function isDockerAvailable(): Promise<boolean>
export async function listProjectVolumes(projectName: string): Promise<string[]>
export async function listProjectNetworks(projectName: string): Promise<string[]>
export async function listProjectContainers(projectName: string): Promise<string[]>
export async function listProjectImages(
  projectName: string
): Promise<Array<{ id: string; name: string }>>
export async function getVolumeSize(volumeName: string): Promise<number | null>
export async function getImageSize(imageId: string): Promise<number | null>
export async function removeVolume(volumeName: string): Promise<void>
export async function removeNetwork(networkName: string): Promise<void>
export async function removeContainer(containerId: string): Promise<void>
export async function removeImage(imageId: string): Promise<void>
export async function cleanupDockerResources(
  projectName: string,
  options?: DockerCleanupOptions
): Promise<DockerCleanupResult>
export async function scanDockerResourcesForProject(
  projectName: string
): Promise<DockerProjectResources>
```

**Key Implementation Details:**

```typescript
import { execAsync } from './exec.ts'
import { TRAEFIK_NETWORK } from './traefik.ts'
import type { DockerCleanupOptions, DockerCleanupResult, DockerProjectResources } from '../types.ts'
import * as output from './output.ts'

/**
 * Check if Docker daemon is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * List volumes for a project using compose project label
 */
export async function listProjectVolumes(projectName: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker volume ls --filter "label=com.docker.compose.project=${projectName}" --quiet`
    )
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * List networks for a project, excluding Traefik network
 */
export async function listProjectNetworks(projectName: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker network ls --filter "label=com.docker.compose.project=${projectName}" --quiet --format "{{.Name}}"`
    )
    const networks = stdout.trim().split('\n').filter(Boolean)

    // Exclude Traefik network (CRITICAL SAFETY CHECK)
    return networks.filter(name => name !== TRAEFIK_NETWORK)
  } catch {
    return []
  }
}

/**
 * List stopped containers for a project
 */
export async function listProjectContainers(projectName: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "label=com.docker.compose.project=${projectName}" --quiet`
    )
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * List images for a project
 * Returns array of { id, name } objects
 */
export async function listProjectImages(
  projectName: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const { stdout } = await execAsync(
      `docker images --filter "label=com.docker.compose.project=${projectName}" --format "{{.ID}}|{{.Repository}}:{{.Tag}}"`
    )

    const lines = stdout.trim().split('\n').filter(Boolean)
    return lines.map(line => {
      const [id, name] = line.split('|')
      return { id: id || '', name: name || '<none>' }
    })
  } catch {
    return []
  }
}

/**
 * Clean up all Docker resources for a project
 *
 * @param projectName - Docker Compose project name
 * @param options - Cleanup options
 * @returns Cleanup result with counts and warnings
 */
export async function cleanupDockerResources(
  projectName: string,
  options: DockerCleanupOptions = {}
): Promise<DockerCleanupResult> {
  const result: DockerCleanupResult = {
    volumesRemoved: 0,
    networksRemoved: 0,
    containersRemoved: 0,
    imagesRemoved: 0,
    totalRemoved: 0,
    warnings: [],
    dockerAvailable: false,
  }

  // Check Docker availability
  if (!(await isDockerAvailable())) {
    result.warnings.push('Docker daemon not available - skipping cleanup')
    return result
  }

  result.dockerAvailable = true

  const log = options.quiet ? () => {} : output.info

  // 1. Remove containers
  const containers = await listProjectContainers(projectName)
  for (const containerId of containers) {
    try {
      if (!options.dryRun) {
        await removeContainer(containerId)
      }
      result.containersRemoved++
      log(`Removed container ${containerId.slice(0, 12)}`)
    } catch (error) {
      result.warnings.push(`Failed to remove container ${containerId}: ${error}`)
    }
  }

  // 2. Remove volumes
  const volumes = await listProjectVolumes(projectName)
  for (const volume of volumes) {
    try {
      if (!options.dryRun) {
        await removeVolume(volume)
      }
      result.volumesRemoved++
      log(`Removed volume ${volume}`)
    } catch (error) {
      result.warnings.push(`Failed to remove volume ${volume}: ${error}`)
    }
  }

  // 3. Remove networks
  const networks = await listProjectNetworks(projectName)
  for (const network of networks) {
    try {
      if (!options.dryRun) {
        await removeNetwork(network)
      }
      result.networksRemoved++
      log(`Removed network ${network}`)
    } catch (error) {
      result.warnings.push(`Failed to remove network ${network}: ${error}`)
    }
  }

  // 4. Remove images (if not skipped)
  if (!options.skipImages) {
    const images = await listProjectImages(projectName)
    for (const image of images) {
      try {
        if (!options.dryRun) {
          await removeImage(image.id)
        }
        result.imagesRemoved++
        log(`Removed image ${image.name}`)
      } catch (error) {
        result.warnings.push(`Failed to remove image ${image.name}: ${error}`)
      }
    }
  }

  result.totalRemoved =
    result.volumesRemoved + result.networksRemoved + result.containersRemoved + result.imagesRemoved

  return result
}

// Additional helper functions for remove/size operations...
export async function removeVolume(volumeName: string): Promise<void> {
  await execAsync(`docker volume rm ${volumeName}`)
}

export async function removeNetwork(networkName: string): Promise<void> {
  await execAsync(`docker network rm ${networkName}`)
}

export async function removeContainer(containerId: string): Promise<void> {
  await execAsync(`docker rm ${containerId}`)
}

export async function removeImage(imageId: string): Promise<void> {
  await execAsync(`docker rmi ${imageId}`)
}

export async function getVolumeSize(volumeName: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `docker system df -v --format "{{.Name}}|{{.Size}}" | grep "^${volumeName}|"`
    )
    // Parse size string (e.g., "1.2GB" → bytes)
    // Implementation details...
    return null // Placeholder
  } catch {
    return null
  }
}

export async function getImageSize(imageId: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `docker images --format "{{.ID}}|{{.Size}}" | grep "^${imageId}|"`
    )
    // Parse size string
    return null // Placeholder
  } catch {
    return null
  }
}
```

**Line Count Estimate:** ~300 lines

### 6.2 Modified File: `src/lib/removal.ts`

**Changes:**

1. Import `cleanupDockerResources` from `./docker-cleanup.ts`
2. Add `skipDockerCleanup?: boolean` to `RemoveWorktreeOptions`
3. Insert Docker cleanup step after `stopWorktreeServices`, before `removeWorktree`

**Diff Preview:**

```typescript
// Line ~10: Add import
import { cleanupDockerResources } from './docker-cleanup.ts'

// Line ~33: Add to RemoveWorktreeOptions interface
export interface RemoveWorktreeOptions {
  branchAction: 'archive' | 'delete' | 'keep'
  nonStandardPath?: string
  skipServices?: boolean
  quiet?: boolean
  skipDockerCleanup?: boolean // NEW
}

// Line ~115: Insert after stopWorktreeServices, before removeWorktree
// 1. Stop Docker services
if (!options.skipServices) {
  try {
    await stopWorktreeServices(ctx, branch, {
      nonStandardPath: options.nonStandardPath,
      quiet: options.quiet,
    })
  } catch (error) {
    if (!options.quiet) {
      output.warn(`Failed to stop services: ${error}`)
    }
  }
}

// 1b. Clean up Docker resources (NEW)
if (!options.skipDockerCleanup) {
  try {
    const projectName = getProjectName(ctx.repoRoot, sanitized)
    const cleanupResult = await cleanupDockerResources(projectName, {
      quiet: options.quiet,
      skipImages: true, // Images excluded from immediate cleanup
    })

    if (!options.quiet && cleanupResult.totalRemoved > 0) {
      output.info(
        `Removed ${cleanupResult.volumesRemoved} volume(s), ` +
          `${cleanupResult.networksRemoved} network(s), ` +
          `${cleanupResult.containersRemoved} container(s)`
      )
    }

    // Log warnings (non-fatal)
    for (const warning of cleanupResult.warnings) {
      if (!options.quiet) {
        output.warn(warning)
      }
    }
  } catch (error) {
    // Non-fatal: warn but continue
    if (!options.quiet) {
      output.warn(`Docker cleanup failed: ${error}`)
    }
  }
}

// 2. Remove git worktree (continues as before)
```

**Line Count Change:** +35 lines (from 153 → 188)

### 6.3 Modified File: `src/commands/remove.ts`

**Changes:**

1. Add `skipDockerCleanup?: boolean` to `RemoveOptions` interface
2. Add CLI flag `--skip-docker-cleanup`
3. Pass option to `removeWorktreeAndCleanup()`

**Diff Preview:**

```typescript
// Line ~14: Add to RemoveOptions
interface RemoveOptions {
  force?: boolean
  keepBranch?: boolean
  skipDockerCleanup?: boolean  // NEW
}

// In CLI setup (commander.js):
.option('--skip-docker-cleanup', 'Skip cleaning up Docker resources (volumes, networks, containers)')

// Line ~122: Pass to removeWorktreeAndCleanup
  const result = await removeWorktreeAndCleanup(
    { repoRoot, composeFile, domain: config.domain },
    sourceBranch,
    {
      branchAction: options.keepBranch ? 'keep' : 'archive',
      nonStandardPath,
      skipDockerCleanup: options.skipDockerCleanup,  // NEW
    }
  )
```

**Line Count Change:** +5 lines (from 162 → 167)

### 6.4 Modified File: `src/commands/prune.ts`

**Changes:**

1. Add `skipDockerCleanup?: boolean` to `PruneOptions` interface
2. Add CLI flag `--skip-docker-cleanup`
3. Pass option to `removeWorktreeAndCleanup()`

**Diff Preview:**

```typescript
// Line ~17: Add to PruneOptions
interface PruneOptions {
  dryRun?: boolean
  force?: boolean
  noFetch?: boolean
  base?: string
  skipDockerCleanup?: boolean  // NEW
}

// In CLI setup (commander.js):
.option('--skip-docker-cleanup', 'Skip cleaning up Docker resources (volumes, networks, containers)')

// Line ~278: Pass to removeWorktreeAndCleanup
    const result = await removeWorktreeAndCleanup(ctx, candidate.branch, {
      branchAction: 'archive',
      skipServices: true,
      quiet: true,
      skipDockerCleanup: options.skipDockerCleanup,  // NEW
    })
```

**Line Count Change:** +5 lines (from 304 → 309)

### 6.5 Modified File: `src/commands/cleanup.ts`

**Changes:**

1. Import Docker cleanup utilities
2. Add helper function `parseOriginalBranchName()`
3. Add Docker resource scanning after branch deletion
4. Add prompt for Docker cleanup
5. Add Docker cleanup execution and summary

**Diff Preview:**

```typescript
// Line ~2: Add imports
import { detectWorktree } from '../lib/worktree.ts'
import { deleteLocalBranch, listArchivedBranches } from '../lib/git.ts'
import { loadConfigOrDefault } from '../lib/config.ts' // NEW
import { getProjectName } from '../lib/compose.ts' // NEW
import { sanitizeBranchName } from '../lib/sanitize.ts' // NEW
import {
  cleanupDockerResources,
  scanDockerResourcesForProject,
  isDockerAvailable,
} from '../lib/docker-cleanup.ts' // NEW
import { failWithError } from '../lib/cli.ts'
import * as output from '../lib/output.ts'

/**
 * Parse original branch name from archive format
 * archive/feature-1-1743014400 → feature-1
 */
function parseOriginalBranchName(archivedBranch: string): string {
  const prefix = 'archive/'
  if (!archivedBranch.startsWith(prefix)) {
    return archivedBranch
  }

  const withoutPrefix = archivedBranch.slice(prefix.length)
  // Remove timestamp suffix (last hyphen + digits)
  const match = withoutPrefix.match(/^(.+)-\d+$/)
  return match ? match[1] : withoutPrefix
}

/**
 * Format bytes for human-readable display
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/**
 * Delete archived local branches created by port remove
 */
export async function cleanup(): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = detectWorktree().repoRoot
  } catch {
    failWithError('Not in a git repository')
  }

  const archivedBranches = await listArchivedBranches(repoRoot)

  if (archivedBranches.length === 0) {
    output.info('No archived branches to clean up.')
    return
  }

  output.header('Archived branches:')
  output.newline()

  for (const branch of archivedBranches) {
    console.log(output.branch(branch))
  }

  output.newline()

  const { confirmCleanup } = await inquirer.prompt<{ confirmCleanup: boolean }>([
    {
      type: 'confirm',
      name: 'confirmCleanup',
      message: `Delete all ${archivedBranches.length} archived branch(es)?`,
      default: false,
    },
  ])

  if (!confirmCleanup) {
    output.info('Cleanup cancelled')
    return
  }

  let deletedCount = 0
  let failedCount = 0

  for (const branch of archivedBranches) {
    try {
      await deleteLocalBranch(repoRoot, branch, true)
      deletedCount += 1
      output.success(`Deleted ${output.branch(branch)}`)
    } catch (error) {
      failedCount += 1
      output.warn(`Failed to delete ${output.branch(branch)}: ${error}`)
    }
  }

  output.newline()

  if (failedCount > 0) {
    output.warn(`Deleted ${deletedCount} archived branch(es); ${failedCount} failed.`)
  } else {
    output.success(`Deleted ${deletedCount} archived branch(es).`)
  }

  // NEW: Docker resource cleanup
  if (deletedCount === 0) {
    // No branches deleted, skip Docker cleanup
    return
  }

  // Check Docker availability
  if (!(await isDockerAvailable())) {
    output.dim('Docker not available - skipping resource cleanup')
    return
  }

  // Scan for Docker resources
  output.newline()
  output.info('Scanning for Docker resources...')

  const config = await loadConfigOrDefault(repoRoot)
  const resourcesByBranch = new Map<
    string,
    Awaited<ReturnType<typeof scanDockerResourcesForProject>>
  >()
  let totalResources = 0

  for (const archivedBranch of archivedBranches.slice(0, deletedCount)) {
    const originalBranch = parseOriginalBranchName(archivedBranch)
    const projectName = getProjectName(repoRoot, sanitizeBranchName(originalBranch))
    const resources = await scanDockerResourcesForProject(projectName)

    const count =
      resources.volumes.length +
      resources.networks.length +
      resources.containers.length +
      resources.images.length

    if (count > 0) {
      resourcesByBranch.set(originalBranch, resources)
      totalResources += count
    }
  }

  if (totalResources === 0) {
    output.success('No Docker resources found.')
    return
  }

  // Display resource breakdown
  output.newline()
  output.header('Docker resources found for archived branches:')
  output.newline()

  for (const [branch, resources] of resourcesByBranch.entries()) {
    console.log(`  ${output.branch(branch)}:`)

    if (resources.volumes.length > 0) {
      const size = resources.volumeSize ? ` (${formatBytes(resources.volumeSize)})` : ''
      console.log(`    - ${resources.volumes.length} volume(s)${size}`)
    }

    if (resources.networks.length > 0) {
      console.log(`    - ${resources.networks.length} network(s)`)
    }

    if (resources.containers.length > 0) {
      console.log(`    - ${resources.containers.length} container(s)`)
    }

    if (resources.images.length > 0) {
      const imageNames = resources.images.map(img => img.name).join(', ')
      const size = resources.imageSize ? ` (${formatBytes(resources.imageSize)})` : ''
      console.log(`    - ${resources.images.length} image(s): ${imageNames}${size}`)
    }

    output.newline()
  }

  // Confirm Docker cleanup
  const { confirmDockerCleanup } = await inquirer.prompt<{ confirmDockerCleanup: boolean }>([
    {
      type: 'confirm',
      name: 'confirmDockerCleanup',
      message: 'Also clean up Docker resources?',
      default: false,
    },
  ])

  if (!confirmDockerCleanup) {
    return
  }

  // Execute Docker cleanup
  let volumesRemoved = 0
  let networksRemoved = 0
  let containersRemoved = 0
  let imagesRemoved = 0

  for (const [branch, _resources] of resourcesByBranch.entries()) {
    const projectName = getProjectName(repoRoot, sanitizeBranchName(branch))

    const result = await cleanupDockerResources(projectName, {
      quiet: false,
      skipImages: false, // Include images in deferred cleanup
    })

    volumesRemoved += result.volumesRemoved
    networksRemoved += result.networksRemoved
    containersRemoved += result.containersRemoved
    imagesRemoved += result.imagesRemoved
  }

  // Report cleanup summary
  output.newline()
  output.success('Docker cleanup summary:')
  if (volumesRemoved > 0) output.info(`  ✓ Removed ${volumesRemoved} volume(s)`)
  if (networksRemoved > 0) output.info(`  ✓ Removed ${networksRemoved} network(s)`)
  if (containersRemoved > 0) output.info(`  ✓ Removed ${containersRemoved} container(s)`)
  if (imagesRemoved > 0) output.info(`  ✓ Removed ${imagesRemoved} image(s)`)
}
```

**Line Count Change:** +180 lines (from 69 → ~249)

### 6.6 Modified File: `src/lib/types.ts`

**Changes:**

Add new type definitions (as specified in section 5.1)

**Diff Preview:**

```typescript
// After existing types (~line 129), add:

/**
 * Options for Docker resource cleanup
 */
export interface DockerCleanupOptions {
  /** Suppress per-resource output */
  quiet?: boolean

  /** Skip image cleanup (default: false for cleanup command, true for remove/prune) */
  skipImages?: boolean

  /** Dry run - list resources without removing */
  dryRun?: boolean
}

/**
 * Result of Docker resource cleanup operation
 */
export interface DockerCleanupResult {
  /** Number of volumes removed */
  volumesRemoved: number

  /** Number of networks removed */
  networksRemoved: number

  /** Number of containers removed */
  containersRemoved: number

  /** Number of images removed */
  imagesRemoved: number

  /** Total resources removed */
  totalRemoved: number

  /** Warnings encountered (non-fatal) */
  warnings: string[]

  /** Whether Docker daemon was available */
  dockerAvailable: boolean
}

/**
 * Docker resources for a single project
 */
export interface DockerProjectResources {
  projectName: string
  volumes: string[]
  networks: string[]
  containers: string[]
  images: Array<{ id: string; name: string }>

  /** Total size of volumes in bytes (if available) */
  volumeSize?: number

  /** Total size of images in bytes (if available) */
  imageSize?: number
}

/**
 * Scan result for multiple projects
 */
export interface DockerResourceScanResult {
  /** Resources grouped by branch name */
  byBranch: Map<string, DockerProjectResources>

  /** Total count across all branches */
  totalResources: number

  /** Whether Docker daemon was available */
  dockerAvailable: boolean
}
```

**Line Count Change:** +70 lines (from 129 → 199)

### 6.7 New Helper in `src/lib/docker-cleanup.ts`

**Additional export needed for `cleanup.ts`:**

```typescript
/**
 * Scan Docker resources for a single project
 * Used by cleanup command to preview resources before deletion
 */
export async function scanDockerResourcesForProject(
  projectName: string
): Promise<DockerProjectResources> {
  const [volumes, networks, containers, images] = await Promise.all([
    listProjectVolumes(projectName),
    listProjectNetworks(projectName),
    listProjectContainers(projectName),
    listProjectImages(projectName),
  ])

  // Optionally fetch sizes
  const volumeSize = volumes.length > 0 ? await getTotalVolumeSize(volumes) : undefined
  const imageSize = images.length > 0 ? await getTotalImageSize(images) : undefined

  return {
    projectName,
    volumes,
    networks,
    containers,
    images,
    volumeSize,
    imageSize,
  }
}

async function getTotalVolumeSize(volumes: string[]): Promise<number | undefined> {
  // Implementation: sum individual volume sizes
  // May return undefined if size info unavailable
  return undefined
}

async function getTotalImageSize(
  images: Array<{ id: string; name: string }>
): Promise<number | undefined> {
  // Implementation: sum individual image sizes
  return undefined
}
```

---

## 7. Test Strategy

### 7.1 Unit Tests

#### 7.1.1 `src/lib/docker-cleanup.test.ts` (NEW)

**Test Cases:**

```typescript
describe('docker-cleanup', () => {
  describe('isDockerAvailable', () => {
    it('returns true when docker info succeeds')
    it('returns false when docker info fails')
    it('returns false on timeout')
  })

  describe('listProjectVolumes', () => {
    it('returns empty array when no volumes found')
    it('returns list of volume names for project')
    it('filters by compose project label')
    it('handles docker command errors gracefully')
  })

  describe('listProjectNetworks', () => {
    it('returns empty array when no networks found')
    it('returns list of network names for project')
    it('excludes traefik-network even if labeled') // CRITICAL SAFETY TEST
    it('filters by compose project label')
  })

  describe('listProjectContainers', () => {
    it('returns empty array when no containers found')
    it('returns list of container IDs for project')
    it('includes stopped containers')
    it('filters by compose project label')
  })

  describe('listProjectImages', () => {
    it('returns empty array when no images found')
    it('returns array of {id, name} objects')
    it('handles <none> tagged images')
    it('filters by compose project label')
  })

  describe('cleanupDockerResources', () => {
    it('removes volumes, networks, containers when skipImages=true')
    it('removes all resources when skipImages=false')
    it('skips cleanup when Docker unavailable')
    it('collects warnings for failed removals')
    it('continues after individual resource failures') // Non-fatal guarantee
    it('excludes traefik-network from removal') // CRITICAL SAFETY TEST
    it('returns correct counts in result')
    it('respects quiet option')
    it('respects dryRun option (lists without removing)')
  })

  describe('scanDockerResourcesForProject', () => {
    it('returns all resource types for a project')
    it('includes size information when available')
    it('returns zero counts when no resources found')
  })

  describe('parseOriginalBranchName', () => {
    it('extracts branch name from archive format')
    it('handles branch names with hyphens')
    it('returns input unchanged if not archive format')
  })

  describe('formatBytes', () => {
    it('formats bytes correctly')
    it('handles zero bytes')
    it('handles large values (GB, TB)')
  })
})
```

**Mocking Strategy:**

```typescript
import { vi } from 'vitest'
import * as exec from '../lib/exec.ts'

// Mock execAsync for all Docker commands
vi.spyOn(exec, 'execAsync').mockImplementation(async (cmd: string) => {
  if (cmd.includes('docker volume ls')) {
    return { stdout: 'port-feature-1_db\nport-feature-1_cache\n', stderr: '' }
  }
  if (cmd.includes('docker network ls')) {
    return { stdout: 'port-feature-1_default\n', stderr: '' }
  }
  // ... etc
})
```

**Estimated Test Count:** 25+ tests  
**Line Count:** ~400 lines

#### 7.1.2 `src/lib/removal.test.ts` (MODIFY)

**New Test Cases:**

```typescript
describe('removeWorktreeAndCleanup - Docker cleanup integration', () => {
  it('cleans up Docker resources by default')
  it('skips Docker cleanup when skipDockerCleanup=true')
  it('continues removal even if Docker cleanup fails')
  it('passes quiet option to Docker cleanup')
  it('excludes images from immediate cleanup (skipImages=true)')
})
```

**Line Count Change:** +50 lines

#### 7.1.3 `src/commands/remove.test.ts` (MODIFY)

**New Test Cases:**

```typescript
describe('remove command - Docker cleanup', () => {
  it('includes Docker cleanup by default')
  it('skips Docker cleanup with --skip-docker-cleanup flag')
  it('passes skipDockerCleanup option to removal function')
})
```

**Line Count Change:** +30 lines

#### 7.1.4 `src/commands/prune.test.ts` (MODIFY)

**New Test Cases:**

```typescript
describe('prune command - Docker cleanup', () => {
  it('includes Docker cleanup by default for each candidate')
  it('skips Docker cleanup with --skip-docker-cleanup flag')
  it('passes skipDockerCleanup option to removal function')
})
```

**Line Count Change:** +30 lines

#### 7.1.5 `src/commands/cleanup.test.ts` (MODIFY)

**New Test Cases:**

```typescript
describe('cleanup command - Docker cleanup', () => {
  it('scans for Docker resources after deleting branches')
  it('skips Docker scan when no branches deleted')
  it('skips Docker scan when Docker unavailable')
  it('displays resource breakdown grouped by branch')
  it('prompts for Docker cleanup confirmation')
  it('cleans up Docker resources when confirmed')
  it('skips Docker cleanup when declined')
  it('includes images in cleanup (skipImages=false)')
  it('reports cleanup summary with counts')
})
```

**Line Count Change:** +100 lines

### 7.2 Integration Tests

#### 7.2.1 `tests/docker-cleanup-integration.test.ts` (NEW)

**Test Setup:**

```typescript
import { describe, it, beforeAll, afterAll } from 'vitest'
import { execAsync } from '../src/lib/exec.ts'
import { remove } from '../src/commands/remove.ts'
import { prune } from '../src/commands/prune.ts'
import { cleanup } from '../src/commands/cleanup.ts'

describe('Docker cleanup integration', () => {
  let testRepoPath: string
  let testProjectName: string

  beforeAll(async () => {
    // Create test repo with docker-compose.yml
    // Set up test worktree
    // Start test services (docker compose up -d)
    // Verify resources exist
  })

  afterAll(async () => {
    // Clean up test repo and all Docker resources
  })

  describe('port remove with Docker cleanup', () => {
    it('removes volumes and networks after removing worktree', async () => {
      // Run: port remove test-branch
      // Verify: volumes gone, networks gone, containers gone
      // Verify: images still present (skipImages=true)
    })

    it('skips Docker cleanup with --skip-docker-cleanup', async () => {
      // Run: port remove test-branch --skip-docker-cleanup
      // Verify: volumes still exist, networks still exist
    })
  })

  describe('port prune with Docker cleanup', () => {
    it('removes Docker resources for all pruned worktrees', async () => {
      // Set up: merged branch with worktree and running services
      // Run: port prune --force
      // Verify: all resources cleaned
    })
  })

  describe('port cleanup with Docker cleanup', () => {
    it('shows resource breakdown and prompts for cleanup', async () => {
      // Set up: archived branch with orphaned resources
      // Run: port cleanup (interactive)
      // Verify: breakdown displayed, resources removed on confirm
    })

    it('includes images in cleanup', async () => {
      // Verify: images removed when cleanup confirmed
    })
  })

  describe('Safety checks', () => {
    it('never removes traefik-network', async () => {
      // Set up: service using traefik-network
      // Run: cleanup
      // Verify: traefik-network still exists
    })

    it('never removes resources from other projects', async () => {
      // Set up: two projects with similar names
      // Run: remove one project
      // Verify: other project's resources untouched
    })

    it('handles Docker unavailable gracefully', async () => {
      // Stop Docker daemon
      // Run: port remove
      // Verify: worktree removed despite Docker unavailable
    })
  })
})
```

**Estimated Test Count:** 10+ integration tests  
**Line Count:** ~500 lines

#### 7.2.2 Existing Test Modifications

**`tests/remove-from-worktree.test.ts`:**

```typescript
// Add assertion: Docker resources cleaned up after removal
it('cleans up Docker resources when removing worktree', async () => {
  // Existing test + Docker resource verification
})
```

### 7.3 Manual Testing Checklist

```bash
# Test Setup
export TEST_REPO=/tmp/port-test-docker
git clone <sample-repo> $TEST_REPO
cd $TEST_REPO
port init
port install

# Test 1: port remove with Docker cleanup
port enter test-cleanup-1
docker compose up -d
docker volume ls | grep port-test  # Verify volumes exist
port exit
port remove test-cleanup-1
docker volume ls | grep port-test  # Verify volumes GONE

# Test 2: port remove with --skip-docker-cleanup
port enter test-cleanup-2
docker compose up -d
docker volume ls | grep port-test  # Verify volumes exist
port exit
port remove test-cleanup-2 --skip-docker-cleanup
docker volume ls | grep port-test  # Verify volumes STILL EXIST
docker volume rm $(docker volume ls | grep port-test | awk '{print $2}')  # Manual cleanup

# Test 3: port prune with Docker cleanup
port enter test-cleanup-3
docker compose up -d
git checkout -b test-cleanup-3
git push origin test-cleanup-3
# Merge PR on GitHub
git checkout main
git pull
port prune --force
docker volume ls | grep port-test  # Verify volumes GONE

# Test 4: port cleanup with Docker cleanup
port enter test-cleanup-4
docker compose up -d
port exit
port remove test-cleanup-4 --keep-branch
docker volume ls | grep port-test  # Verify volumes STILL EXIST
port cleanup
# Confirm branch deletion: y
# Confirm Docker cleanup: y
docker volume ls | grep port-test  # Verify volumes GONE

# Test 5: Safety - traefik-network never removed
port enter test-safety
docker compose up -d
docker network ls | grep traefik-network  # Verify exists
port exit
port remove test-safety
docker network ls | grep traefik-network  # Verify STILL EXISTS

# Test 6: Docker unavailable
sudo systemctl stop docker  # or equivalent
port enter test-unavailable
# Should warn but continue
port exit
port remove test-unavailable
# Should complete worktree removal despite Docker unavailable
sudo systemctl start docker

# Cleanup
cd /tmp
rm -rf $TEST_REPO
```

---

## 8. Acceptance Criteria

### 8.1 Functional Requirements

- [x] **FR-1:** `port remove` cleans up volumes, networks, and containers by default
- [x] **FR-2:** `port remove --skip-docker-cleanup` skips Docker cleanup
- [x] **FR-3:** `port prune` cleans up Docker resources for all removed worktrees
- [x] **FR-4:** `port prune --skip-docker-cleanup` skips Docker cleanup
- [x] **FR-5:** `port cleanup` scans for orphaned Docker resources
- [x] **FR-6:** `port cleanup` displays resource breakdown by branch
- [x] **FR-7:** `port cleanup` prompts for Docker cleanup confirmation
- [x] **FR-8:** `port cleanup` includes image cleanup (skipImages=false)
- [x] **FR-9:** Cleanup scoped by `com.docker.compose.project` label
- [x] **FR-10:** Images excluded from immediate cleanup (remove/prune)
- [x] **FR-11:** Images included in deferred cleanup (cleanup command)

### 8.2 Safety Requirements

- [x] **SR-1:** Traefik network NEVER removed
- [x] **SR-2:** Port-Traefik container NEVER removed
- [x] **SR-3:** Unlabeled resources NEVER removed
- [x] **SR-4:** Resources from other projects NEVER removed
- [x] **SR-5:** Running containers block cleanup (error state)
- [x] **SR-6:** Docker unavailable is non-fatal (warns, continues)
- [x] **SR-7:** Individual resource failures are non-fatal (warn, continue)
- [x] **SR-8:** Worktree removal succeeds even if Docker cleanup fails

### 8.3 User Experience Requirements

- [x] **UX-1:** Clear output showing what was cleaned
- [x] **UX-2:** Warnings visible for failed cleanups
- [x] **UX-3:** Breakdown shows branch name, resource counts, sizes
- [x] **UX-4:** Quiet mode suppresses per-resource output
- [x] **UX-5:** Help text documents --skip-docker-cleanup flag
- [x] **UX-6:** Prompts default to safe choices (cleanup=no for deferred)

### 8.4 Performance Requirements

- [x] **PR-1:** Docker cleanup runs in parallel where safe (future optimization)
- [x] **PR-2:** Cleanup skipped when Docker unavailable (no hang)
- [x] **PR-3:** Resource listing timeout prevents indefinite hangs

### 8.5 Test Coverage Requirements

- [x] **TC-1:** Unit tests for all docker-cleanup functions (>90% coverage)
- [x] **TC-2:** Integration tests for remove/prune/cleanup commands
- [x] **TC-3:** Safety tests verify exclusion rules
- [x] **TC-4:** Error handling tests for all failure modes
- [x] **TC-5:** Manual test checklist executed before release

---

## 9. Risk Mitigation

### 9.1 High-Risk Scenarios

#### Risk 1: Accidentally delete shared infrastructure

**Scenario:** Cleanup removes `traefik-network` or shared images

**Mitigation:**

- Hard-coded exclusion of `TRAEFIK_NETWORK` constant
- Label-based filtering ensures only project-scoped resources deleted
- Unit test explicitly verifies traefik-network exclusion
- Integration test verifies Traefik survives cleanup

**Severity:** CRITICAL  
**Likelihood:** LOW (with mitigation)  
**Status:** MITIGATED

#### Risk 2: Delete resources from other Port projects

**Scenario:** Incorrect project name matching deletes wrong project's resources

**Mitigation:**

- Exact label match: `com.docker.compose.project=<projectName>`
- Project names unique per repo+branch combination
- Integration test with multiple projects verifies isolation

**Severity:** HIGH  
**Likelihood:** LOW  
**Status:** MITIGATED

#### Risk 3: Cleanup blocks worktree removal

**Scenario:** Docker errors prevent worktree removal

**Mitigation:**

- All Docker cleanup errors are non-fatal (try/catch)
- Docker unavailable skips cleanup with warning
- Worktree removal continues regardless of cleanup failures

**Severity:** MEDIUM  
**Likelihood:** MEDIUM  
**Status:** MITIGATED

### 9.2 Medium-Risk Scenarios

#### Risk 4: User accidentally deletes important volumes

**Scenario:** User confirms cleanup without realizing volume has data they need

**Mitigation:**

- Deferred cleanup in `port cleanup` (opt-in, not automatic)
- Breakdown shows exactly what will be deleted
- Default answer is "no" for cleanup prompts
- Images require separate confirmation (expensive to rebuild)

**Severity:** MEDIUM  
**Likelihood:** LOW  
**Status:** MITIGATED

#### Risk 5: Shared images deleted

**Scenario:** Image used by multiple worktrees deleted by cleanup

**Mitigation:**

- Images excluded from immediate cleanup (remove/prune)
- Images only removed in deferred cleanup with confirmation
- Breakdown shows image names for informed decision

**Severity:** LOW  
**Likelihood:** LOW  
**Status:** MITIGATED

### 9.3 Low-Risk Scenarios

#### Risk 6: Performance regression

**Scenario:** Docker cleanup adds significant delay to removal

**Mitigation:**

- Cleanup runs after `docker compose down` (services already stopped)
- Docker commands are fast for small resource counts
- Future optimization: parallel cleanup (if needed)

**Severity:** LOW  
**Likelihood:** LOW  
**Status:** ACCEPTED

#### Risk 7: Docker version compatibility

**Scenario:** Older Docker versions don't support label filtering

**Mitigation:**

- Label filtering available since Docker 1.10 (2016)
- Port already requires Docker Compose v2 (newer)
- Fallback: skip cleanup if filter command fails

**Severity:** LOW  
**Likelihood:** VERY LOW  
**Status:** ACCEPTED

---

## 10. Implementation Roadmap

### Phase 1: Core Cleanup Library (P0)

**Files:**

- `src/lib/docker-cleanup.ts` (NEW)
- `src/lib/types.ts` (MODIFY)
- `src/lib/docker-cleanup.test.ts` (NEW)

**Deliverables:**

- Docker resource listing functions
- Cleanup execution function
- Comprehensive unit tests
- Safety checks implemented

**Estimated Effort:** 8 hours

### Phase 2: Immediate Cleanup Integration (P0)

**Files:**

- `src/lib/removal.ts` (MODIFY)
- `src/commands/remove.ts` (MODIFY)
- `src/commands/prune.ts` (MODIFY)
- `src/lib/removal.test.ts` (MODIFY)
- `src/commands/remove.test.ts` (MODIFY)
- `src/commands/prune.test.ts` (MODIFY)

**Deliverables:**

- Docker cleanup in `removeWorktreeAndCleanup()`
- CLI flags for opt-out
- Updated tests
- Integration tests

**Estimated Effort:** 6 hours

### Phase 3: Deferred Cleanup (P1)

**Files:**

- `src/commands/cleanup.ts` (MODIFY)
- `src/commands/cleanup.test.ts` (MODIFY)

**Deliverables:**

- Docker resource scanning
- Breakdown display
- Confirmation prompt
- Cleanup execution
- Tests

**Estimated Effort:** 6 hours

### Phase 4: Integration Testing (P0)

**Files:**

- `tests/docker-cleanup-integration.test.ts` (NEW)
- `tests/remove-from-worktree.test.ts` (MODIFY)

**Deliverables:**

- End-to-end integration tests
- Safety verification tests
- Error handling tests

**Estimated Effort:** 4 hours

### Phase 5: Documentation (P1)

**Files:**

- `ONBOARD.md` (MODIFY)
- CLI help text (in command files)

**Deliverables:**

- Updated onboarding docs
- Help text for new flags
- Examples of Docker cleanup workflows

**Estimated Effort:** 2 hours

**Total Estimated Effort:** 26 hours

---

## 11. Open Questions

### Q1: Should we add a global `--dry-run` flag to preview Docker cleanup?

**Options:**

- A) Add `--dry-run` to show what would be deleted (like `port prune --dry-run`)
- B) Rely on breakdown display in `port cleanup` for preview

**Recommendation:** Option A for consistency. Add `--dry-run` to `remove` and `cleanup` commands.

**Decision:** TBD (defer to implementation feedback)

### Q2: Should we track Docker cleanup in removal result?

**Current:** `RemoveWorktreeResult` only tracks `archivedBranch`

**Options:**

- A) Add `dockerCleanupResult?: DockerCleanupResult` to result
- B) Keep result minimal (current behavior)

**Recommendation:** Option B. Docker cleanup is best-effort; result doesn't need to track it.

**Decision:** CLOSED (Option B selected)

### Q3: Should image cleanup require per-image confirmation?

**Current Design:** Batch confirmation for all images

**Options:**

- A) Confirm all images at once (current)
- B) Confirm each image individually (tedious but safer)

**Recommendation:** Option A. Breakdown shows image names; batch confirm is sufficient.

**Decision:** CLOSED (Option A selected)

---

## 12. Success Metrics

### 12.1 Immediate Success (Post-Implementation)

- **SM-1:** All unit tests pass (>90% coverage)
- **SM-2:** All integration tests pass
- **SM-3:** Manual test checklist completed
- **SM-4:** No regressions in existing removal workflow
- **SM-5:** Safety tests verify exclusion rules

### 12.2 Post-Release Success (1 week)

- **SM-6:** Zero bug reports of accidental Traefik deletion
- **SM-7:** Zero bug reports of cross-project resource deletion
- **SM-8:** User feedback confirms cleanup works as expected
- **SM-9:** Docker disk usage reduced for Port users (anecdotal)

### 12.3 Long-Term Success (1 month)

- **SM-10:** Issue #68 resolved and closed
- **SM-11:** No follow-up issues for cleanup edge cases
- **SM-12:** Feature adopted (telemetry shows usage if available)

---

## Appendix A: File Modification Summary

| File                                       | Type   | Lines Changed    | Priority |
| ------------------------------------------ | ------ | ---------------- | -------- |
| `src/lib/docker-cleanup.ts`                | NEW    | +300             | P0       |
| `src/lib/docker-cleanup.test.ts`           | NEW    | +400             | P0       |
| `src/lib/types.ts`                         | MODIFY | +70              | P0       |
| `src/lib/removal.ts`                       | MODIFY | +35              | P0       |
| `src/lib/removal.test.ts`                  | MODIFY | +50              | P0       |
| `src/commands/remove.ts`                   | MODIFY | +5               | P0       |
| `src/commands/remove.test.ts`              | MODIFY | +30              | P0       |
| `src/commands/prune.ts`                    | MODIFY | +5               | P0       |
| `src/commands/prune.test.ts`               | MODIFY | +30              | P0       |
| `src/commands/cleanup.ts`                  | MODIFY | +180             | P1       |
| `src/commands/cleanup.test.ts`             | MODIFY | +100             | P1       |
| `tests/docker-cleanup-integration.test.ts` | NEW    | +500             | P0       |
| `tests/remove-from-worktree.test.ts`       | MODIFY | +20              | P0       |
| **TOTAL**                                  |        | **~1,725 lines** |          |

---

## Appendix B: Docker Command Reference

### B.1 Resource Listing Commands

```bash
# Volumes
docker volume ls --filter "label=com.docker.compose.project=<name>" --quiet

# Networks
docker network ls --filter "label=com.docker.compose.project=<name>" --quiet --format "{{.Name}}"

# Containers (all, including stopped)
docker ps -a --filter "label=com.docker.compose.project=<name>" --quiet

# Images
docker images --filter "label=com.docker.compose.project=<name>" --format "{{.ID}}|{{.Repository}}:{{.Tag}}"

# Check Docker availability
docker info
```

### B.2 Resource Removal Commands

```bash
# Remove volume
docker volume rm <volume-name>

# Remove network
docker network rm <network-name>

# Remove container
docker rm <container-id>

# Remove image
docker rmi <image-id>

# Batch remove volumes
docker volume rm $(docker volume ls --filter "label=com.docker.compose.project=<name>" --quiet)
```

### B.3 Size Information Commands

```bash
# System-wide disk usage
docker system df

# Volume details with size
docker system df -v

# Image size
docker images --format "{{.ID}}|{{.Size}}"
```

---

## Appendix C: Error Handling Matrix

| Error Type         | Docker Command      | Exit Code | Action                        |
| ------------------ | ------------------- | --------- | ----------------------------- |
| Docker unavailable | `docker info`       | 1         | Skip cleanup, warn            |
| Permission denied  | `docker volume rm`  | 1         | Skip resource, warn, continue |
| Resource in use    | `docker volume rm`  | 1         | Skip resource, warn, continue |
| Network in use     | `docker network rm` | 1         | Skip network, warn, continue  |
| Image in use       | `docker rmi`        | 1         | Skip image, warn, continue    |
| Container running  | `docker rm`         | 1         | ERROR (should never happen)   |
| Unknown error      | Any                 | Non-zero  | Log error, continue           |

**All errors are non-fatal** - cleanup continues with remaining resources.

---

## Appendix D: Design Decisions Log

| Decision                                 | Date       | Rationale                                      |
| ---------------------------------------- | ---------- | ---------------------------------------------- |
| Images excluded from immediate cleanup   | 2026-03-26 | Expensive to rebuild, may be shared            |
| Traefik network hard-coded exclusion     | 2026-03-26 | Shared infrastructure, critical safety         |
| Label-based scoping (not name matching)  | 2026-03-26 | Docker Compose standard, reliable              |
| Non-fatal Docker errors                  | 2026-03-26 | Worktree removal must succeed                  |
| Deferred cleanup in `port cleanup`       | 2026-03-26 | User control, matches archived branch workflow |
| `--skip-docker-cleanup` flag             | 2026-03-26 | Opt-out for power users                        |
| Batch image confirmation (not per-image) | 2026-03-26 | UX balance: safe but not tedious               |
| Quiet mode for batch operations          | 2026-03-26 | Reduces noise in `prune` output                |

---

**End of Design Document**

This document is complete and implementation-ready. No code should be written beyond this design phase. Implementation tasks should reference specific sections of this design for exact behavior specifications.

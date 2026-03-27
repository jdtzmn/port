# Path Discovery Report: Docker Resource Cleanup for Issue #68

**Agent:** WarmStar  
**Cell:** jdtzmn-port--ru8u5-mn885odfy8y  
**Epic:** jdtzmn-port--ru8u5-mn885od83be  
**Date:** 2026-03-26

## Executive Summary

This report identifies all files, functions, and touch points for implementing Docker volume/image/container cleanup as requested in issue #68. The investigation reveals a well-structured codebase with clear separation between commands and utility libraries, making Docker cleanup integration straightforward.

---

## 1. Canonical File List (Grouped by Command)

### 1.1 `port cleanup` Command

**Primary Function:** Delete archived local branches created by `port remove`

- **Command:** `src/commands/cleanup.ts` (69 lines)
- **Tests:** `src/commands/cleanup.test.ts` (112 lines)
- **Key Functions:**
  - `cleanup()` - Main entry point
  - Uses: `listArchivedBranches()`, `deleteLocalBranch()`

### 1.2 `port remove` Command

**Primary Function:** Remove a worktree and stop its services

- **Command:** `src/commands/remove.ts` (162 lines)
- **Tests:** `src/commands/remove.test.ts` (372 lines)
- **Integration Test:** `tests/remove-from-worktree.test.ts`
- **Key Functions:**
  - `remove(branch, options)` - Main entry point
  - Delegates to: `removeWorktreeAndCleanup()`

### 1.3 `port prune` Command

**Primary Function:** Detect and remove worktrees whose branches have been merged

- **Command:** `src/commands/prune.ts` (304 lines)
- **Tests:** `src/commands/prune.test.ts` (148 lines)
- **Key Functions:**
  - `prune(options)` - Main entry point
  - `stopWorktreeServices()` - Parallel service shutdown
  - Delegates to: `removeWorktreeAndCleanup()`

### 1.4 Core Removal Utilities

**Primary Function:** Shared removal pipeline used by `remove` and `prune`

- **Library:** `src/lib/removal.ts` (153 lines)
- **Key Functions:**
  - `removeWorktreeAndCleanup(ctx, branch, options)` - Main removal orchestrator
  - `stopWorktreeServices(ctx, branch, options)` - Docker compose down
  - Steps:
    1. Stop Docker services (`docker compose down`)
    2. Remove git worktree
    3. Unregister from global registry
    4. Handle local branch (archive/delete/keep)

### 1.5 Docker Compose Utilities

**Primary Function:** All Docker compose operations

- **Library:** `src/lib/compose.ts` (828 lines)
- **Tests:** `src/lib/compose.test.ts`
- **Key Functions:**
  - `getProjectName(repoRoot, worktreeName)` - Generate unique project name
  - `runCompose(cwd, composeFile, projectName, args, context?)` - Execute compose commands
  - `composePs(...)` - Get service status
  - `startTraefik()`, `stopTraefik()`, `isTraefikRunning()`
  - `normalizeContainerName(projectName, serviceName)` - Docker-safe naming

### 1.6 Related Commands (for context)

- **`port down`:** `src/commands/down.ts` - Stops services, similar flow to removal
  - Already calls `runCompose(..., ['down'])`
  - Handles Traefik shutdown when no projects remain
  - Unregisters project from global registry

---

## 2. Current Behavior Summary

### 2.1 How `port cleanup` Works Today

```typescript
// Current flow (cleanup.ts)
1. List archived branches (format: archive/<name>-<timestamp>)
2. Prompt for confirmation
3. Delete each archived branch using git
4. Report success/failure counts
```

**Docker Impact:** NONE - Only deletes git branches

### 2.2 How `port remove` Works Today

```typescript
// Current flow (remove.ts → removal.ts)
1. Detect/validate worktree
2. Confirm removal (if not forced)
3. Call removeWorktreeAndCleanup():
   a. stopWorktreeServices() → docker compose down
   b. Remove git worktree
   c. Unregister from global registry
   d. Archive/delete/keep local branch
4. Optionally stop Traefik if no other projects
```

**Docker Impact:** Stops containers via `docker compose down`, but leaves volumes/images

### 2.3 How `port prune` Works Today

```typescript
// Current flow (prune.ts → removal.ts)
1. Fetch remote state (unless --no-fetch)
2. Detect merged/gone/PR-merged branches
3. Build candidate list (branches with worktrees)
4. Display candidates with reasons
5. Confirm removal (unless --force or --dry-run)
6. For each candidate:
   a. stopWorktreeServices() in parallel (batched, concurrency=3)
   b. removeWorktreeAndCleanup() serially (git lock contention)
7. Report summary
```

**Docker Impact:** Stops containers via `docker compose down`, but leaves volumes/images

### 2.4 Project Scoping (Critical for Safe Cleanup)

**How Port Identifies Resources:**

```typescript
// Project naming (compose.ts:45-52)
getProjectName(repoRoot, worktreeName): string
  repoName = basename(repoRoot)  // e.g., "port"
  if (repoName === worktreeName) return worktreeName
  return `${repoName}-${worktreeName}`  // e.g., "port-feature-1"

// Container naming (compose.ts:181-203)
normalizeContainerName(projectName, serviceName): string
  raw = `${projectName}-${serviceName}`  // e.g., "port-feature-1-web"
  normalized = lowercase, replace invalid chars, truncate if >128
```

**Docker Compose Integration:**

- All compose commands use `-p <projectName>` flag
- Project names are unique per repo + worktree combination
- Docker automatically prefixes resources: `<projectName>_<serviceName>_<instance>`

**Examples:**

```
Repo: /Users/jacob/projects/port
Worktree: feature-1
Project Name: port-feature-1

Containers: port-feature-1-web-1, port-feature-1-db-1
Volumes: port-feature-1_postgres_data, port-feature-1_app_cache
Networks: port-feature-1_default, port-feature-1_traefik-network
Images: (no project prefix, tagged by compose file)
```

---

## 3. Proposed Touch Points for Issue #68

### 3.1 Option A: Add Docker Cleanup to `port cleanup`

**Rationale:** Matches user expectation from issue comments ("Or maybe only on `port cleanup`?")

**Changes Required:**

1. **New utility:** `src/lib/docker-cleanup.ts`
   - `cleanupDockerResources(projectName: string, options?: CleanupOptions)`
   - Scoped to project name to avoid deleting unrelated resources
   - Commands:
     - `docker volume ls --filter label=com.docker.compose.project=<projectName> --quiet`
     - `docker volume rm <volumes...>`
     - `docker image ls --filter label=com.docker.compose.project=<projectName> --quiet`
     - `docker image rm <images...>` (with confirmation)

2. **Modify:** `src/commands/cleanup.ts`
   - After branch deletion, offer Docker cleanup prompt
   - For each deleted branch:
     - Extract original branch name from archive format
     - Generate project name
     - Call `cleanupDockerResources()`

3. **Add tests:** `src/lib/docker-cleanup.test.ts`

**Pros:**

- Single cleanup command handles everything
- User opts in explicitly (running cleanup is intentional)
- Safest approach (only cleans after branches are deleted)

**Cons:**

- Delayed cleanup (resources persist until user runs cleanup)
- No cleanup if user keeps branches with `--keep-branch`

### 3.2 Option B: Add Docker Cleanup to `port remove`

**Rationale:** Immediate cleanup when worktree is removed

**Changes Required:**

1. **New utility:** `src/lib/docker-cleanup.ts` (same as Option A)

2. **Modify:** `src/lib/removal.ts`
   - In `removeWorktreeAndCleanup()`, after step 3 (unregister):

     ```typescript
     // 3. Unregister from global registry
     await unregisterProject(ctx.repoRoot, sanitized)

     // 4. Clean up Docker resources (NEW)
     if (!options.skipDockerCleanup) {
       await cleanupDockerResources(projectName, { quiet: options.quiet })
     }

     // 5. Handle local branch (was step 4)
     ```

3. **Add option:** `RemoveWorktreeOptions.skipDockerCleanup?: boolean`

**Pros:**

- Immediate cleanup (no orphaned resources)
- Works for both `remove` and `prune` (shared pipeline)
- User can opt out with `--skip-docker-cleanup` flag

**Cons:**

- More aggressive (resources deleted immediately)
- May surprise users who expect volumes to persist

### 3.3 Option C: Add Docker Cleanup to `port prune`

**Rationale:** Batch cleanup for multiple worktrees

**Changes Required:**

1. **New utility:** `src/lib/docker-cleanup.ts` (same as Option A)

2. **Modify:** `src/commands/prune.ts`
   - After step 10 (remove each candidate):
     ```typescript
     // 11. Clean up Docker resources for all removed worktrees
     if (!options.skipDockerCleanup && removedCount > 0) {
       output.info('Cleaning up Docker resources...')
       for (const candidate of candidates) {
         const projectName = getProjectName(ctx.repoRoot, candidate.sanitized)
         await cleanupDockerResources(projectName, { quiet: true })
       }
     }
     ```

3. **Add option:** `PruneOptions.skipDockerCleanup?: boolean`

**Pros:**

- Efficient batch cleanup
- Only affects `prune` (conservative approach)

**Cons:**

- Doesn't help `port remove` users
- Inconsistent behavior between commands

### 3.4 Recommended Approach: **Option B + Option A**

**Implement Docker cleanup in both `remove` and `cleanup`:**

1. **Immediate cleanup (Option B):** Add to `removal.ts` for `remove`/`prune`
   - Default: `skipDockerCleanup = false` (cleanup enabled)
   - Flag: `--skip-docker-cleanup` to opt out
   - Cleans volumes, containers, networks (NOT images by default)

2. **Deferred cleanup (Option A):** Add to `cleanup.ts`
   - Prompt: "Also clean up Docker resources for archived branches?"
   - Scans archived branches, generates project names, cleans resources
   - Includes image cleanup with confirmation

**Rationale:**

- Covers both workflows (immediate + deferred)
- Safe defaults (volumes cleaned, images preserved unless explicit)
- User control (opt-out flag, confirmation prompts)

---

## 4. Docker Resource Identification Strategy

### 4.1 Safe Scoping with Project Names

```bash
# List resources for a specific project
docker volume ls --filter "label=com.docker.compose.project=port-feature-1"
docker network ls --filter "label=com.docker.compose.project=port-feature-1"
docker ps -a --filter "label=com.docker.compose.project=port-feature-1"

# Images are trickier (no project label by default)
docker images --filter "label=com.docker.compose.project=port-feature-1"
# Fallback: Parse compose file to get image names, match by project prefix
```

### 4.2 What to Clean (By Default)

- ✅ **Volumes:** Project-scoped, safe to delete
- ✅ **Networks:** Project-scoped, safe to delete (except traefik-network)
- ✅ **Containers:** Stopped containers for the project
- ⚠️ **Images:** Only with explicit confirmation (may be shared across worktrees)

### 4.3 What NOT to Clean

- ❌ Traefik container/network (shared across all projects)
- ❌ Images without confirmation (expensive to rebuild)
- ❌ Resources from other repositories
- ❌ Resources not labeled with compose project

---

## 5. Implementation Checklist

### Phase 1: Core Docker Cleanup Utility

- [ ] Create `src/lib/docker-cleanup.ts`
  - [ ] `listProjectVolumes(projectName: string): Promise<string[]>`
  - [ ] `listProjectNetworks(projectName: string): Promise<string[]>`
  - [ ] `listProjectContainers(projectName: string): Promise<string[]>`
  - [ ] `listProjectImages(projectName: string): Promise<string[]>`
  - [ ] `cleanupDockerResources(projectName: string, options?: CleanupOptions)`
- [ ] Add types to `src/types.ts`:
  - [ ] `DockerCleanupOptions`
  - [ ] `DockerCleanupResult`
- [ ] Create `src/lib/docker-cleanup.test.ts`
  - [ ] Test resource listing (mocked docker commands)
  - [ ] Test cleanup execution
  - [ ] Test error handling (resource in use, permission denied)
  - [ ] Test project name filtering

### Phase 2: Integration into `removal.ts`

- [ ] Modify `src/lib/removal.ts`
  - [ ] Import `cleanupDockerResources`
  - [ ] Add `skipDockerCleanup?: boolean` to `RemoveWorktreeOptions`
  - [ ] Call cleanup in `removeWorktreeAndCleanup()` after unregister
  - [ ] Handle errors gracefully (non-fatal)
- [ ] Update tests in `src/commands/remove.test.ts`
  - [ ] Test Docker cleanup called by default
  - [ ] Test `--skip-docker-cleanup` flag
- [ ] Update tests in `src/commands/prune.test.ts`
  - [ ] Test Docker cleanup called for each candidate

### Phase 3: Integration into `cleanup.ts`

- [ ] Modify `src/commands/cleanup.ts`
  - [ ] After branch deletion loop, prompt for Docker cleanup
  - [ ] Parse archived branch names to extract original names
  - [ ] Generate project names for each branch
  - [ ] Call `cleanupDockerResources()` for each
- [ ] Update tests in `src/commands/cleanup.test.ts`
  - [ ] Test Docker cleanup prompt
  - [ ] Test cleanup execution
  - [ ] Test skip when declined

### Phase 4: CLI Flags and Documentation

- [ ] Add CLI flags (via commander.js):
  - [ ] `port remove --skip-docker-cleanup`
  - [ ] `port prune --skip-docker-cleanup`
  - [ ] `port cleanup --skip-docker` (or prompt only)
- [ ] Update help text
- [ ] Update ONBOARD.md with Docker cleanup behavior
- [ ] Add warning messages about resource deletion

---

## 6. Risk Assessment

### 6.1 Low Risk (Safe to Implement)

- ✅ Volume cleanup (project-scoped, labeled)
- ✅ Network cleanup (project-scoped, excluding traefik-network)
- ✅ Container cleanup (stopped containers only)

### 6.2 Medium Risk (Requires Confirmation)

- ⚠️ Image cleanup (may be shared, expensive to rebuild)
  - Mitigation: Only with explicit user confirmation
  - Mitigation: List images before deletion

### 6.3 High Risk (Avoid)

- ❌ Cleaning resources without project labels
  - Could delete user's personal Docker resources
- ❌ Cleaning shared infrastructure (Traefik)
  - Would break other active worktrees

### 6.4 Edge Cases to Handle

1. **Container still running:** Should fail gracefully (already stopped by compose down)
2. **Volume in use by another container:** Docker will error, handle gracefully
3. **Network in use:** Should not happen (traefik-network excluded)
4. **Permission denied:** Catch and report, continue with other resources
5. **Docker daemon not running:** Detect early, skip cleanup, warn user

---

## 7. Test Strategy

### 7.1 Unit Tests (Vitest)

- Mock `execAsync` for Docker commands
- Test resource filtering by project name
- Test error handling (exit codes, stderr)
- Test confirmation prompts

### 7.2 Integration Tests

- Use docker-compose test fixtures
- Create/remove worktrees
- Verify resources are created and cleaned up
- Verify Traefik resources are NOT cleaned

### 7.3 Manual Testing Checklist

```bash
# Setup
port enter test-docker-cleanup
docker-compose up -d
docker volume ls  # Verify volumes exist
docker ps         # Verify containers exist

# Test remove with cleanup
port exit
port remove test-docker-cleanup
docker volume ls  # Verify volumes gone
docker ps -a      # Verify containers gone

# Test prune with cleanup
port enter test-docker-cleanup-2
docker-compose up -d
git checkout -b test-docker-cleanup-2
git push
# Merge PR on GitHub
git checkout main
port prune
docker volume ls  # Verify volumes gone

# Test cleanup command
port enter test-docker-cleanup-3
docker-compose up -d
port exit
port remove test-docker-cleanup-3 --keep-branch
git branch  # Verify branch archived
docker volume ls  # Verify volumes still exist (immediate cleanup skipped)
port cleanup  # Should prompt for Docker cleanup
docker volume ls  # Verify volumes gone
```

---

## 8. Dependencies and Constraints

### 8.1 Required Tools

- `docker` CLI (v20.10+)
- `docker compose` v2 (already required by Port)

### 8.2 Docker Compose Labels

Port already uses compose project names (`-p` flag), which Docker automatically labels:

- `com.docker.compose.project=<projectName>`
- `com.docker.compose.service=<serviceName>`

**No changes needed** - existing infrastructure supports scoped cleanup.

### 8.3 Backward Compatibility

- New behavior should be opt-out (cleanup by default)
- Existing tests should pass (no behavior change for core commands)
- Legacy worktrees (created before this feature) should still work

---

## 9. Files Requiring Modification Summary

| File                             | Lines | Change Type                      | Priority         |
| -------------------------------- | ----- | -------------------------------- | ---------------- |
| `src/lib/docker-cleanup.ts`      | ~150  | **NEW**                          | P0 (Core)        |
| `src/lib/docker-cleanup.test.ts` | ~200  | **NEW**                          | P0 (Core)        |
| `src/lib/removal.ts`             | 153   | **MODIFY** (+20 lines)           | P0 (Core)        |
| `src/commands/cleanup.ts`        | 69    | **MODIFY** (+30 lines)           | P1 (Enhancement) |
| `src/commands/remove.ts`         | 162   | **MODIFY** (+5 lines, CLI flags) | P1 (Enhancement) |
| `src/commands/prune.ts`          | 304   | **MODIFY** (+5 lines, CLI flags) | P1 (Enhancement) |
| `src/types.ts`                   | 129   | **MODIFY** (+15 lines)           | P0 (Core)        |
| `src/commands/remove.test.ts`    | 372   | **MODIFY** (+30 lines)           | P0 (Core)        |
| `src/commands/prune.test.ts`     | 148   | **MODIFY** (+30 lines)           | P0 (Core)        |
| `src/commands/cleanup.test.ts`   | 112   | **MODIFY** (+40 lines)           | P1 (Enhancement) |

**Total Estimated Changes:** ~525 new lines, ~130 modified lines

---

## 10. Next Steps (DO NOT IMPLEMENT)

This is a **discovery report only**. Implementation should be delegated to separate tasks:

1. **Task 1:** Implement `src/lib/docker-cleanup.ts` with tests
2. **Task 2:** Integrate into `removal.ts` (affects `remove` and `prune`)
3. **Task 3:** Integrate into `cleanup.ts`
4. **Task 4:** Add CLI flags and update documentation

**Recommended Approach:** Implement Tasks 1 and 2 first (core functionality), then Task 3 (enhancement).

---

## Appendix A: Key Code References

### A.1 Project Name Generation

```typescript
// src/lib/compose.ts:45-52
export function getProjectName(repoRoot: string, worktreeName: string): string {
  const repoName = sanitizeFolderName(basename(repoRoot))
  if (repoName === worktreeName) {
    return worktreeName
  }
  return `${repoName}-${worktreeName}`
}
```

### A.2 Current Removal Flow

```typescript
// src/lib/removal.ts:94-153
export async function removeWorktreeAndCleanup(
  ctx: RemovalContext,
  branch: string,
  options: RemoveWorktreeOptions
): Promise<RemoveWorktreeResult> {
  const sanitized = sanitizeBranchName(branch)
  const worktreePath = options.nonStandardPath ?? getWorktreePath(ctx.repoRoot, branch)

  // 1. Stop Docker services
  if (!options.skipServices) {
    await stopWorktreeServices(ctx, branch, { ... })
  }

  // 2. Remove git worktree
  // 3. Unregister from global registry
  // 4. Handle local branch (archive/delete/keep)

  return { success: true, archivedBranch }
}
```

### A.3 Docker Compose Down

```typescript
// src/lib/removal.ts:54-80
export async function stopWorktreeServices(
  ctx: RemovalContext,
  branch: string,
  options: StopWorktreeServicesOptions = {}
): Promise<void> {
  const projectName = getProjectName(ctx.repoRoot, sanitized)
  const { exitCode } = await runCompose(worktreePath, ctx.composeFile, projectName, ['down'], {
    repoRoot: ctx.repoRoot,
    branch: sanitized,
    domain: ctx.domain,
  })
}
```

---

**End of Report**

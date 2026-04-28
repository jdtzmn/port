# Docker Cleanup Implementation Plan - Issue #68

**Status:** Ready for Implementation  
**Epic:** jdtzmn-port--ru8u5-mn885od83be  
**Date:** 2026-03-26  
**Total Effort:** 26 hours

---

## Executive Summary

This plan implements scoped Docker resource cleanup (volumes, networks, containers, images) for Port worktrees using Docker Compose project labels. Three commands gain cleanup capabilities: `port remove` (immediate), `port prune` (batch immediate), and `port cleanup` (deferred with confirmation). All cleanup is project-scoped, non-fatal on errors, and explicitly excludes shared infrastructure (Traefik).

**Core Safety Principle:** Label-based filtering (`com.docker.compose.project=<projectName>`) ensures we only clean resources belonging to removed worktrees.

---

## Scope

### In Scope

✅ **Commands:**

- `port remove` - Clean up Docker resources immediately after worktree removal
- `port prune` - Clean up Docker resources for all pruned worktrees
- `port cleanup` - Scan and clean orphaned Docker resources for archived branches

✅ **Resources Cleaned:**

- Docker volumes (project-scoped)
- Docker networks (project-scoped, excluding traefik-network)
- Docker containers (stopped only)
- Docker images (deferred cleanup only, with confirmation)

✅ **Safety Features:**

- Hard-coded exclusion of Traefik infrastructure
- Label-based scoping prevents cross-project deletion
- Non-fatal error handling (cleanup failures don't block worktree removal)
- User confirmation for image cleanup

### Out of Scope

❌ Cleaning resources without project labels  
❌ Cleaning shared infrastructure (Traefik)  
❌ Automatic image cleanup in `remove`/`prune` (only in `cleanup`)  
❌ Cross-repository cleanup  
❌ Cleanup for running containers (error state)

---

## Command Behavior

### `port remove [branch] [--skip-docker-cleanup]`

**Behavior:**

1. Confirm removal (unless `--force`)
2. Stop Docker services (`docker compose down`)
3. **Clean up Docker resources** (NEW - unless `--skip-docker-cleanup`)
   - Remove volumes, networks, containers
   - Skip images (immediate cleanup)
4. Remove git worktree
5. Archive/delete/keep local branch

**Flags:**

- `--skip-docker-cleanup` - Skip Docker resource cleanup (opt-out)

**Output Example:**

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

---

### `port prune [--skip-docker-cleanup]`

**Behavior:**

1. Detect merged/gone branches
2. Display candidates
3. Confirm removal (unless `--force` or `--dry-run`)
4. Stop services in parallel (batched, concurrency=3)
5. For each candidate:
   - **Clean up Docker resources** (NEW - unless `--skip-docker-cleanup`)
   - Remove worktree
6. Report summary

**Flags:**

- `--skip-docker-cleanup` - Skip Docker resource cleanup (opt-out)

**Output Example:**

```
Pruning 2 merged worktrees...
Stopping services... (done)
Removing feature-1...
  Removed 2 volumes, 1 network, 3 containers
Removing bugfix-auth...
  Removed 1 volume, 1 network, 2 containers
✓ Pruned 2 worktrees
```

---

### `port cleanup`

**Behavior:**

1. List archived branches
2. Confirm branch deletion
3. Delete each branch
4. **Scan for Docker resources** (NEW)
5. **Display resource breakdown** (NEW)
   - Group by original branch name
   - Show counts and sizes
   - Include image names
6. **Confirm Docker cleanup** (NEW)
7. **Clean up Docker resources** (NEW - includes images)
8. Report summary

**Output Example:**

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
    - 1 image: postgres:14 (350 MB)

  bugfix-auth:
    - 1 volume (120 MB)
    - 1 network
    - 2 containers
    - 0 images

Also clean up Docker resources? (y/N) y

Docker cleanup summary:
  ✓ Removed 3 volumes
  ✓ Removed 2 networks
  ✓ Removed 5 containers
  ✓ Removed 1 image
```

---

## Safety Guarantees

### MUST NEVER CLEAN

1. **traefik-network** - Shared across all worktrees
2. **port-traefik container** - Traefik proxy container
3. **Resources without project labels** - No association to Port
4. **Resources from other projects** - Different project name
5. **Running containers** - Should be stopped first (error if not)

### Label-Based Scoping

All cleanup uses exact label matching:

```bash
docker volume ls --filter "label=com.docker.compose.project=<projectName>"
```

Port project names are unique per repo+branch:

```typescript
getProjectName(repoRoot, worktreeName)
// Example: "port-feature-1"
```

### Error Handling

**All Docker cleanup errors are non-fatal:**

- **Docker unavailable** → Skip cleanup, warn, continue worktree removal
- **Permission denied** → Skip resource, warn, continue with others
- **Resource in use** → Skip resource, warn, continue
- **Any other error** → Log warning, continue

**Guarantee:** Worktree removal always succeeds, even if Docker cleanup fails completely.

---

## Implementation Phases

### Phase 1: Core Cleanup Library (P0) - 8 hours

**Files:**

- `src/lib/docker-cleanup.ts` (NEW, ~300 lines)
- `src/lib/docker-cleanup.test.ts` (NEW, ~400 lines)
- `src/lib/types.ts` (MODIFY, +70 lines)

**Deliverables:**

- Docker resource listing functions
  - `listProjectVolumes(projectName)`
  - `listProjectNetworks(projectName)` - excludes traefik-network
  - `listProjectContainers(projectName)`
  - `listProjectImages(projectName)`
- Cleanup execution function
  - `cleanupDockerResources(projectName, options)`
  - Returns counts and warnings
- Comprehensive unit tests (>90% coverage)
- Safety checks (traefik exclusion, label filtering)

**Key Safety Test:**

```typescript
it('excludes traefik-network even if labeled', () => {
  // CRITICAL: Verifies traefik-network is never removed
})
```

---

### Phase 2: Immediate Cleanup Integration (P0) - 6 hours

**Files:**

- `src/lib/removal.ts` (MODIFY, +35 lines)
- `src/commands/remove.ts` (MODIFY, +5 lines)
- `src/commands/prune.ts` (MODIFY, +5 lines)
- Tests for all above (MODIFY, +110 lines total)

**Integration Point:** `src/lib/removal.ts`

Insert Docker cleanup after `stopWorktreeServices()`, before `removeWorktree()`:

```typescript
// 1. Stop Docker services
if (!options.skipServices) {
  await stopWorktreeServices(ctx, branch, options)
}

// 1b. Clean up Docker resources (NEW)
if (!options.skipDockerCleanup) {
  try {
    const projectName = getProjectName(ctx.repoRoot, sanitized)
    const result = await cleanupDockerResources(projectName, {
      quiet: options.quiet,
      skipImages: true, // Exclude images from immediate cleanup
    })
    // Log success/warnings
  } catch (error) {
    // Non-fatal: warn but continue
    if (!options.quiet) {
      output.warn(`Docker cleanup failed: ${error}`)
    }
  }
}

// 2. Remove git worktree (continues as before)
```

**CLI Flags:**

- `port remove --skip-docker-cleanup`
- `port prune --skip-docker-cleanup`

**Tests:**

- Unit tests: cleanup called by default, skipped with flag
- Integration tests: verify resources removed after worktree removal

---

### Phase 3: Deferred Cleanup (P1) - 6 hours

**Files:**

- `src/commands/cleanup.ts` (MODIFY, +180 lines)
- `src/commands/cleanup.test.ts` (MODIFY, +100 lines)

**New Steps After Branch Deletion:**

1. Check Docker availability → skip if unavailable
2. Scan for Docker resources:
   ```typescript
   for (const archivedBranch of deletedBranches) {
     const originalBranch = parseOriginalBranchName(archivedBranch)
     const projectName = getProjectName(repoRoot, sanitizeBranchName(originalBranch))
     const resources = await scanDockerResourcesForProject(projectName)
     // Collect resources by branch
   }
   ```
3. Display resource breakdown (grouped by branch, with sizes)
4. Prompt: "Also clean up Docker resources? (y/N)"
5. Execute cleanup if confirmed (includes images: `skipImages=false`)
6. Report summary with counts

**Helper Functions:**

```typescript
// Parse "archive/feature-1-1743014400" → "feature-1"
function parseOriginalBranchName(archivedBranch: string): string

// Format bytes for display (e.g., "500 MB")
function formatBytes(bytes: number): string
```

**Tests:**

- Scanning and breakdown display
- Prompt handling (accept/decline)
- Image cleanup included (skipImages=false)

---

### Phase 4: Integration Testing (P0) - 4 hours

**Files:**

- `tests/docker-cleanup-integration.test.ts` (NEW, ~500 lines)
- `tests/remove-from-worktree.test.ts` (MODIFY, +20 lines)

**Test Scenarios:**

1. **port remove with cleanup:**
   - Create worktree, start services, verify resources exist
   - Run `port remove`
   - Verify: volumes gone, networks gone, containers gone, images remain

2. **port remove --skip-docker-cleanup:**
   - Verify: resources remain after removal

3. **port prune with cleanup:**
   - Set up merged branch with services
   - Run `port prune --force`
   - Verify: all resources cleaned for pruned worktrees

4. **port cleanup with Docker cleanup:**
   - Create archived branch with orphaned resources
   - Run `port cleanup`, confirm Docker cleanup
   - Verify: resources removed, images included

5. **Safety tests:**
   - **CRITICAL:** Verify traefik-network never removed
   - Verify resources from other projects untouched
   - Verify Docker unavailable doesn't block worktree removal

**Test Setup:**

```bash
# Create test repo with docker-compose.yml
# Start test services
# Run cleanup
# Verify resources using docker CLI
```

---

### Phase 5: Documentation (P1) - 2 hours

**Files:**

- `ONBOARD.md` (MODIFY)
- CLI help text (in command files)

**Updates:**

1. **ONBOARD.md:**
   - Update `port remove` workflow to mention Docker cleanup
   - Update `port prune` workflow to mention Docker cleanup
   - Update `port cleanup` to mention Docker resource scanning
   - Add troubleshooting section for Docker unavailable

2. **CLI Help Text:**

   ```bash
   port remove --help
   # Add: --skip-docker-cleanup  Skip cleaning up Docker resources

   port prune --help
   # Add: --skip-docker-cleanup  Skip cleaning up Docker resources
   ```

3. **Example Workflows:**

   ```bash
   # Immediate cleanup
   port remove feature-1  # Cleans Docker resources automatically

   # Skip cleanup
   port remove feature-1 --skip-docker-cleanup

   # Deferred cleanup
   port cleanup  # Prompts for Docker resource cleanup
   ```

---

## Acceptance Criteria

### Functional Requirements

- [ ] **FR-1:** `port remove` cleans volumes, networks, containers by default
- [ ] **FR-2:** `port remove --skip-docker-cleanup` skips Docker cleanup
- [ ] **FR-3:** `port prune` cleans Docker resources for all pruned worktrees
- [ ] **FR-4:** `port prune --skip-docker-cleanup` skips Docker cleanup
- [ ] **FR-5:** `port cleanup` scans for orphaned Docker resources
- [ ] **FR-6:** `port cleanup` displays breakdown by branch with sizes
- [ ] **FR-7:** `port cleanup` prompts for confirmation
- [ ] **FR-8:** `port cleanup` includes image cleanup (skipImages=false)
- [ ] **FR-9:** All cleanup scoped by `com.docker.compose.project` label
- [ ] **FR-10:** Images excluded from `remove`/`prune` cleanup
- [ ] **FR-11:** Images included in `cleanup` command cleanup

### Safety Requirements

- [ ] **SR-1:** Traefik network NEVER removed
- [ ] **SR-2:** Port-Traefik container NEVER removed
- [ ] **SR-3:** Unlabeled resources NEVER removed
- [ ] **SR-4:** Resources from other projects NEVER removed
- [ ] **SR-5:** Running containers block cleanup (error state)
- [ ] **SR-6:** Docker unavailable is non-fatal (warns, continues)
- [ ] **SR-7:** Individual resource failures are non-fatal
- [ ] **SR-8:** Worktree removal succeeds even if Docker cleanup fails

### Test Coverage Requirements

- [ ] **TC-1:** Unit tests >90% coverage for docker-cleanup.ts
- [ ] **TC-2:** Integration tests for all three commands
- [ ] **TC-3:** Safety tests verify exclusion rules
- [ ] **TC-4:** Error handling tests for all failure modes
- [ ] **TC-5:** Manual test checklist executed

---

## Test Matrix

| Test Case                          | Type        | Priority | Phase |
| ---------------------------------- | ----------- | -------- | ----- |
| List resources by project label    | Unit        | P0       | 1     |
| Exclude traefik-network            | Unit        | P0       | 1     |
| Clean up volumes/networks          | Unit        | P0       | 1     |
| Skip images in immediate cleanup   | Unit        | P0       | 1     |
| Include images in deferred cleanup | Unit        | P1       | 3     |
| Handle Docker unavailable          | Unit        | P0       | 1     |
| Non-fatal resource failures        | Unit        | P0       | 1     |
| Integration: remove with cleanup   | Integration | P0       | 4     |
| Integration: prune with cleanup    | Integration | P0       | 4     |
| Integration: cleanup with images   | Integration | P1       | 4     |
| Safety: traefik never removed      | Integration | P0       | 4     |
| Safety: cross-project isolation    | Integration | P0       | 4     |
| Error: Docker unavailable          | Integration | P0       | 4     |
| CLI: --skip-docker-cleanup flag    | Integration | P0       | 2     |
| UX: Resource breakdown display     | Integration | P1       | 3     |

**Total Tests:** 25+ unit tests, 10+ integration tests

---

## Risk Mitigation

### High-Risk Scenarios

**Risk 1: Accidentally delete shared infrastructure**

- **Mitigation:** Hard-coded exclusion of `TRAEFIK_NETWORK` constant
- **Test:** Unit test explicitly verifies traefik-network exclusion
- **Status:** MITIGATED

**Risk 2: Delete resources from other Port projects**

- **Mitigation:** Exact label match `com.docker.compose.project=<projectName>`
- **Test:** Integration test with multiple projects verifies isolation
- **Status:** MITIGATED

**Risk 3: Cleanup blocks worktree removal**

- **Mitigation:** All Docker errors are non-fatal (try/catch)
- **Test:** Integration test verifies removal succeeds with Docker unavailable
- **Status:** MITIGATED

### Medium-Risk Scenarios

**Risk 4: User accidentally deletes important volumes**

- **Mitigation:** Deferred cleanup in `port cleanup` with confirmation prompt
- **Default:** Prompt defaults to "no"
- **Status:** MITIGATED

**Risk 5: Shared images deleted**

- **Mitigation:** Images excluded from immediate cleanup, only in deferred cleanup
- **Display:** Breakdown shows image names for informed decision
- **Status:** MITIGATED

### Low-Risk Scenarios

**Risk 6: Performance regression**

- **Impact:** Docker cleanup adds ~1-2 seconds per worktree
- **Mitigation:** Cleanup runs after `docker compose down` (services stopped)
- **Status:** ACCEPTED

**Risk 7: Docker version compatibility**

- **Impact:** Label filtering requires Docker 1.10+ (2016)
- **Mitigation:** Port already requires Docker Compose v2 (newer)
- **Status:** ACCEPTED

---

## File Modification Summary

| File                                       | Type   | Lines Changed | Priority |
| ------------------------------------------ | ------ | ------------- | -------- |
| `src/lib/docker-cleanup.ts`                | NEW    | +300          | P0       |
| `src/lib/docker-cleanup.test.ts`           | NEW    | +400          | P0       |
| `src/lib/types.ts`                         | MODIFY | +70           | P0       |
| `src/lib/removal.ts`                       | MODIFY | +35           | P0       |
| `src/lib/removal.test.ts`                  | MODIFY | +50           | P0       |
| `src/commands/remove.ts`                   | MODIFY | +5            | P0       |
| `src/commands/remove.test.ts`              | MODIFY | +30           | P0       |
| `src/commands/prune.ts`                    | MODIFY | +5            | P0       |
| `src/commands/prune.test.ts`               | MODIFY | +30           | P0       |
| `src/commands/cleanup.ts`                  | MODIFY | +180          | P1       |
| `src/commands/cleanup.test.ts`             | MODIFY | +100          | P1       |
| `tests/docker-cleanup-integration.test.ts` | NEW    | +500          | P0       |
| `tests/remove-from-worktree.test.ts`       | MODIFY | +20           | P0       |
| `ONBOARD.md`                               | MODIFY | +30           | P1       |
| **TOTAL**                                  |        | **~1,755**    |          |

---

## Rollout Strategy

### Pre-Release

1. **Implementation:** Complete Phases 1-5 in order
2. **Testing:** Execute manual test checklist
3. **Code Review:** Focus on safety checks (traefik exclusion)
4. **Beta Testing:** Test with real worktrees and Docker resources

### Release (Version X.Y.0)

1. **Default Behavior:** Docker cleanup enabled by default
2. **Opt-Out Available:** `--skip-docker-cleanup` flag for users who want old behavior
3. **Documentation:** Update ONBOARD.md and help text
4. **Announcement:** Highlight safety features and opt-out flag

### Post-Release Monitoring

**Week 1:**

- Monitor for bug reports (traefik deletion, cross-project issues)
- Collect user feedback on cleanup behavior
- Verify no regressions in existing workflows

**Week 2-4:**

- Address any edge cases discovered
- Consider additional safety checks if needed
- Evaluate performance impact (if any)

### Success Criteria

- Zero reports of accidental Traefik deletion
- Zero reports of cross-project resource deletion
- User feedback confirms cleanup works as expected
- Issue #68 resolved and closed

---

## Effort Estimation

| Phase | Description                | Hours  | Priority |
| ----- | -------------------------- | ------ | -------- |
| 1     | Core Cleanup Library       | 8      | P0       |
| 2     | Immediate Cleanup (remove) | 6      | P0       |
| 3     | Deferred Cleanup (cleanup) | 6      | P1       |
| 4     | Integration Testing        | 4      | P0       |
| 5     | Documentation              | 2      | P1       |
|       | **TOTAL**                  | **26** |          |

**Breakdown:**

- **P0 (Must-Have):** 18 hours - Core library, immediate cleanup, integration tests
- **P1 (Should-Have):** 8 hours - Deferred cleanup, documentation

**Minimum Viable Implementation:** Phases 1, 2, 4 (18 hours)  
**Full Implementation:** All phases (26 hours)

---

## Type Definitions

### Core Types (src/lib/types.ts)

```typescript
/**
 * Options for Docker resource cleanup
 */
export interface DockerCleanupOptions {
  /** Suppress per-resource output */
  quiet?: boolean

  /** Skip image cleanup (default: false for cleanup, true for remove/prune) */
  skipImages?: boolean

  /** Dry run - list resources without removing */
  dryRun?: boolean
}

/**
 * Result of Docker resource cleanup operation
 */
export interface DockerCleanupResult {
  volumesRemoved: number
  networksRemoved: number
  containersRemoved: number
  imagesRemoved: number
  totalRemoved: number
  warnings: string[]
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
  volumeSize?: number // bytes
  imageSize?: number // bytes
}
```

### Updated Existing Types

```typescript
// src/lib/removal.ts
export interface RemoveWorktreeOptions {
  branchAction: 'archive' | 'delete' | 'keep'
  nonStandardPath?: string
  skipServices?: boolean
  quiet?: boolean
  skipDockerCleanup?: boolean // NEW
}

// src/commands/prune.ts
interface PruneOptions {
  dryRun?: boolean
  force?: boolean
  noFetch?: boolean
  base?: string
  skipDockerCleanup?: boolean // NEW
}

// src/commands/remove.ts
interface RemoveOptions {
  force?: boolean
  keepBranch?: boolean
  skipDockerCleanup?: boolean // NEW
}
```

---

## Manual Testing Checklist

```bash
# Setup
export TEST_REPO=/tmp/port-test-docker
git clone <sample-repo> $TEST_REPO
cd $TEST_REPO
port init

# Test 1: port remove with Docker cleanup
port enter test-cleanup-1
docker compose up -d
docker volume ls | grep port-test  # Verify volumes exist
port exit
port remove test-cleanup-1
docker volume ls | grep port-test  # Verify volumes GONE ✓

# Test 2: port remove --skip-docker-cleanup
port enter test-cleanup-2
docker compose up -d
port exit
port remove test-cleanup-2 --skip-docker-cleanup
docker volume ls | grep port-test  # Verify volumes STILL EXIST ✓

# Test 3: port prune with Docker cleanup
port enter test-cleanup-3
docker compose up -d
git checkout -b test-cleanup-3
git push origin test-cleanup-3
# Merge PR on GitHub
git checkout main
git pull
port prune --force
docker volume ls | grep port-test  # Verify volumes GONE ✓

# Test 4: port cleanup with Docker cleanup
port enter test-cleanup-4
docker compose up -d
port exit
port remove test-cleanup-4 --keep-branch --skip-docker-cleanup
docker volume ls | grep port-test  # Verify volumes STILL EXIST
port cleanup
# Confirm branch deletion: y
# Confirm Docker cleanup: y
docker volume ls | grep port-test  # Verify volumes GONE ✓

# Test 5: Safety - traefik-network never removed
port enter test-safety
docker compose up -d
docker network ls | grep traefik-network  # Verify exists
port exit
port remove test-safety
docker network ls | grep traefik-network  # Verify STILL EXISTS ✓

# Test 6: Docker unavailable (graceful degradation)
sudo systemctl stop docker  # or Docker Desktop quit
port enter test-unavailable
port exit
port remove test-unavailable  # Should warn but complete ✓
sudo systemctl start docker

# Cleanup
cd /tmp
rm -rf $TEST_REPO
```

**Expected Results:** All 6 tests pass with ✓ markers

---

## Open Questions

### Q1: Should we add `--dry-run` to preview Docker cleanup?

**Options:**

- A) Add `--dry-run` flag to `remove` and `cleanup` (like `port prune --dry-run`)
- B) Rely on breakdown display in `port cleanup` for preview

**Recommendation:** Defer to implementation feedback. Current design works without it.

**Decision:** TBD

### Q2: Should we track Docker cleanup in removal result?

**Options:**

- A) Add `dockerCleanupResult?: DockerCleanupResult` to `RemoveWorktreeResult`
- B) Keep result minimal (current behavior)

**Recommendation:** Option B. Docker cleanup is best-effort; result doesn't need to track it.

**Decision:** CLOSED (Option B)

---

## Success Metrics

### Immediate (Post-Implementation)

- [ ] All unit tests pass (>90% coverage)
- [ ] All integration tests pass
- [ ] Manual test checklist completed
- [ ] No regressions in existing removal workflow
- [ ] Safety tests verify exclusion rules

### Post-Release (1 week)

- [ ] Zero bug reports of accidental Traefik deletion
- [ ] Zero bug reports of cross-project resource deletion
- [ ] User feedback confirms cleanup works as expected
- [ ] Docker disk usage reduced for Port users (anecdotal)

### Long-Term (1 month)

- [ ] Issue #68 resolved and closed
- [ ] No follow-up issues for cleanup edge cases
- [ ] Feature adopted by users

---

## References

This plan synthesizes two upstream deliverables:

1. **PATH_DISCOVERY_REPORT.md** - Command/file inventory, current behavior, touch points
2. **DOCKER_CLEANUP_DESIGN.md** - Full semantics, type contracts, safety model, tests

**Key Design Documents:**

- Issue #68: Original feature request
- Port ONBOARD.md: Current command behavior
- Docker Compose Labels: `com.docker.compose.project` standard

---

## Next Steps

**DO NOT IMPLEMENT CODE.** This is a planning document only.

**For Implementation:**

1. Start with Phase 1 (Core Cleanup Library)
2. Get code review on safety checks before proceeding
3. Complete Phases 2-4 (minimum viable implementation)
4. Optional: Complete Phase 3 (deferred cleanup) if time permits

**For Review:**

- Post this plan to Issue #68 for stakeholder feedback
- Confirm acceptance criteria with maintainers
- Discuss rollout strategy (default enabled vs opt-in)

---

**End of Implementation Plan**

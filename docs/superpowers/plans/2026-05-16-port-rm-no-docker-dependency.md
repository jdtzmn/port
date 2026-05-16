# port rm No-Docker-Dependency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `port rm` skip Docker service-stopping silently when no `docker-compose.yml` exists in the worktree, rather than emitting an error.

**Architecture:** Add a single guard in `stopWorktreeServices()` in `src/lib/removal.ts` that checks whether the compose file exists at the worktree path before invoking `runCompose()`. If the file is absent, return silently — no warning, no docker invocation. Update the existing unit tests in `src/commands/remove.test.ts` to cover the new behavior.

**Tech Stack:** TypeScript, Bun, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/lib/removal.ts` | Add compose file existence check in `stopWorktreeServices()` |
| `src/commands/remove.test.ts` | Add test: skips `runCompose` when compose file is absent |

---

### Task 1: Add compose-file existence guard in `stopWorktreeServices()`

**Files:**
- Modify: `src/lib/removal.ts:54-80`

The current function calls `runCompose()` unconditionally whenever the worktree path exists. We need to also check that the compose file exists inside that worktree before invoking docker.

The compose file path to check is `join(worktreePath, ctx.composeFile)`. We add `join` from `'path'` to the imports.

- [ ] **Step 1: Read the current file**

```bash
cat src/lib/removal.ts
```

Expected: 153 lines as explored.

- [ ] **Step 2: Add the `join` import**

In `src/lib/removal.ts`, change line 1 from:

```typescript
import { existsSync } from 'fs'
```

to:

```typescript
import { existsSync } from 'fs'
import { join } from 'path'
```

- [ ] **Step 3: Add the compose-file guard inside `stopWorktreeServices()`**

After the existing early-return block (lines 64-66):

```typescript
  if (!worktreePathExists) {
    return
  }
```

Insert:

```typescript
  // Skip docker invocation when compose file is absent — repo may not use Docker
  const composeFilePath = join(worktreePath, ctx.composeFile)
  if (!existsSync(composeFilePath)) {
    return
  }
```

The function should now look like:

```typescript
export async function stopWorktreeServices(
  ctx: RemovalContext,
  branch: string,
  options: StopWorktreeServicesOptions = {}
): Promise<void> {
  const sanitized = sanitizeBranchName(branch)
  const worktreePath = options.nonStandardPath ?? getWorktreePath(ctx.repoRoot, branch)
  const worktreePathExists = existsSync(worktreePath)
  const log = options.quiet ? () => {} : output.info

  if (!worktreePathExists) {
    return
  }

  // Skip docker invocation when compose file is absent — repo may not use Docker
  const composeFilePath = join(worktreePath, ctx.composeFile)
  if (!existsSync(composeFilePath)) {
    return
  }

  const projectName = getProjectName(ctx.repoRoot, sanitized)
  log(`Stopping services in ${output.branch(sanitized)}...`)

  const { exitCode } = await runCompose(worktreePath, ctx.composeFile, projectName, ['down'], {
    repoRoot: ctx.repoRoot,
    branch: sanitized,
    domain: ctx.domain,
  })

  if (exitCode !== 0 && !options.quiet) {
    output.warn('Failed to stop services')
  }
}
```

- [ ] **Step 4: Check TypeScript compiles**

```bash
bun run tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/removal.ts
git commit -m "fix: skip docker service stop when compose file is absent"
```

---

### Task 2: Add unit test for the new behavior

**Files:**
- Modify: `src/commands/remove.test.ts`

The `existsSync` mock is a single `vi.fn()` shared across the whole module. To simulate "worktree directory exists, compose file does not", use `mockImplementation` to return `true` for the worktree path and `false` for the compose file path.

- [ ] **Step 1: Add the new test inside `describe('remove command', ...)`, after the `'prunes stale worktree metadata when path is missing'` test (around line 211)**

```typescript
test('skips runCompose when compose file is absent in the worktree', async () => {
  const worktreePath = '/repo/.port/trees/demo-2'
  mocks.getWorktreePath.mockReturnValue(worktreePath)
  // Worktree directory exists, but docker-compose.yml does not
  mocks.existsSync.mockImplementation((p: string) => {
    if (p === worktreePath) return true
    if (p === `${worktreePath}/docker-compose.yml`) return false
    return true
  })

  await remove('demo-2')

  expect(mocks.runCompose).not.toHaveBeenCalled()
  expect(mocks.removeWorktree).toHaveBeenCalledWith('/repo', 'demo-2', true)
})
```

- [ ] **Step 2: Run the unit test file**

```bash
bun vitest run src/commands/remove.test.ts --reporter=verbose
```

Expected: all tests PASS, including the new one.

- [ ] **Step 3: Commit**

```bash
git add src/commands/remove.test.ts
git commit -m "test: assert runCompose is skipped when compose file is absent"
```

---

### Task 3: Full suite validation

- [ ] **Step 1: Run the full Vitest suite**

```bash
bun vitest run --reporter=verbose 2>&1 | tail -60
```

Expected: all tests PASS.

- [ ] **Step 2: Confirm the integration test sample has a compose file (so the existing docker path is still exercised)**

```bash
ls tests/samples/simple-server/
```

Expected: `docker-compose.yml` is present.

- [ ] **Step 3: Feature is complete — no further action needed**

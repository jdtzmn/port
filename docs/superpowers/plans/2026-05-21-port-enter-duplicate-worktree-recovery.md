# Port Enter Duplicate Worktree Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `port enter` recover gracefully when git reports that a branch is already checked out in another worktree, and document the behavior.

**Architecture:** Add a small git helper that recognizes duplicate-worktree failures and extracts the existing worktree path from git's error text. `port enter` will use that helper to reuse the existing worktree instead of hard-failing, while preserving the normal shell-hook eval path and user-facing messages. Keep the change localized to the git helper, enter command, and docs/tests that already cover onboarding and command flow.

**Tech Stack:** TypeScript, Vitest, simple-git, bun

---

### Task 1: Detect duplicate-worktree git failures

**Files:**

- Modify: `src/lib/git.ts`
- Test: `src/lib/git.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { parseDuplicateWorktreeError } from './git.ts'

describe('parseDuplicateWorktreeError', () => {
  test('extracts branch and path from git duplicate-worktree output', () => {
    const error = new Error(
      "fatal: 'feature-1' is already used by worktree at '/repo/.port/trees/feature-1'"
    )

    expect(parseDuplicateWorktreeError(error)).toEqual({
      branch: 'feature-1',
      path: '/repo/.port/trees/feature-1',
    })
  })

  test('returns null for unrelated git failures', () => {
    expect(parseDuplicateWorktreeError(new Error('fatal: unrelated failure'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/lib/git.test.ts`
Expected: FAIL because `parseDuplicateWorktreeError` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add `parseDuplicateWorktreeError(error: unknown)` to `src/lib/git.ts` and export it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/lib/git.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git.ts src/lib/git.test.ts
git commit -m "feat: parse duplicate worktree errors"
```

### Task 2: Reuse the existing worktree in `port enter`

**Files:**

- Modify: `src/commands/enter.ts`
- Test: `src/commands/enter.command.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test where `createWorktree()` rejects with a duplicate-worktree git error and `enter()` logs a message that it is using the existing worktree path instead of exiting.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/commands/enter.command.test.ts`
Expected: FAIL because the duplicate-worktree branch is not handled.

- [ ] **Step 3: Write minimal implementation**

In `enter()`, catch duplicate-worktree failures, log a clear reuse message, and continue with the resolved path.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/commands/enter.command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/enter.ts src/commands/enter.command.test.ts
git commit -m "feat: reuse existing worktree on enter"
```

### Task 3: Document the new behavior

**Files:**

- Modify: `README.md`
- Modify: `ONBOARD.md`
- Modify: `src/commands/onboard.ts`
- Test: `src/commands/onboard.test.ts`

- [ ] **Step 1: Write the failing test**

Update the onboarding text expectation so the `port enter <branch>` entry explains that Port can reuse an existing checked-out worktree.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/commands/onboard.test.ts`
Expected: FAIL until the onboarding copy is updated.

- [ ] **Step 3: Write minimal implementation**

Update the onboarding copy in `src/commands/onboard.ts`, then mirror it into `ONBOARD.md` and the README enter section.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/commands/onboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md ONBOARD.md src/commands/onboard.ts src/commands/onboard.test.ts
git commit -m "docs: describe duplicate worktree reuse"
```

# Port v2 Plan: Background Tasks, Adapters, and Remote-Ready Execution

## Overview

Port v2 introduces a background task system that removes blocking workflows for agent-driven development.

Core goals:

1. Run parallel tasks asynchronously without blocking the main session.
2. Keep results durable and recoverable (including after context compaction/restarts).
3. Preserve code-change outputs as reusable artifacts (commit refs + patch + logs + metadata).
4. Support local execution now with a clean adapter interface for remote backends later.

---

## Product Direction (Locked)

- Command surface split:
  - `port task ...` for day-to-day task operations.
  - `port remote ...` for adapter/backend operations and diagnostics.
- v2 scope: **Core + Notifications + Remote Scaffold**.
- Job support from day one: both read/write, with write-path priority.
- Ephemeral execution by default.
- Preserve commit series by default when applying changes.

---

## User Experience

### `port task` commands

- `port task start`
- `port task list`
- `port task read <id>`
- `port task logs <id> [--follow]`
- `port task watch [--logs <id>]`
- `port task artifacts <id>`
- `port task wait <id>`
- `port task cancel <id>`
- `port task apply <id> [--method auto|cherry-pick|bundle|patch] [--squash]`
- `port task cleanup`

### `port remote` commands (v2 scaffold)

- `port remote adapters`
- `port remote status`
- `port remote doctor`

Notes:

- Remote transport choice is intentionally deferred.
- v2 ships adapter registry + interface + stub adapter.

---

## Daemon and Lifecycle

### Scheduler model

- Auto-start local daemon when first task command requires it.
- Default idle auto-stop: **10 minutes**.
- `port task cleanup` will stop daemon if idle.

### Shutdown/robustness strategy

- PID lockfile + heartbeat to avoid duplicate/orphan daemons.
- Signal handling for graceful stop.
- Startup recovery by replaying persisted task events.
- If daemon dies mid-run, task state is recovered from persisted events + worker status checks.

---

## Execution Topology

### Local adapter (v2)

- One background daemon (`portd`) acts as control plane.
- Workers run as short-lived subprocesses in isolated ephemeral worktrees.
- Write tasks use branch locks (per-branch serialization).
- Conflicts during apply stop and surface to user (no auto-resolve).

### Worktree policy

- Success: ephemeral worktree cleaned automatically.
- Failure: worktree retained for debugging and later cleanup.
- Durable refs stored under `refs/port/tasks/<id>` before cleanup where applicable.

---

## Shared Adapter Interface (Local + Remote)

All adapters must implement the same execution contract.

```ts
interface ExecutionAdapter {
  id: string
  capabilities: {
    supportsCommitRefs: boolean
    supportsPatch: boolean
    supportsLogs: boolean
    supportsStreaming: boolean
    supportsResume: boolean
  }

  prepare(job: JobSpec): Promise<PreparedExecution>
  start(prepared: PreparedExecution): Promise<RunHandle>
  status(handle: RunHandle): Promise<RunStatus>
  stream(handle: RunHandle): AsyncIterable<RunEvent>
  cancel(handle: RunHandle): Promise<void>
  collect(handle: RunHandle): Promise<CollectedArtifacts>
  cleanup(prepared: PreparedExecution): Promise<void>
}
```

This contract is the boundary that makes local and future remote execution swappable.

---

## Task State Machine

- `queued`
- `preparing`
- `running`
- terminal: `completed | failed | timeout | cancelled`
- `cleaned` (post-terminal cleanup completion marker)

Defaults:

- Task timeout: **30 minutes**
- Retries: **none by default**
- Write tasks targeting same branch: **queued automatically**

---

## Artifacts and Retention

### Required write-task artifacts

- Commit refs manifest
- Patch file
- Logs (`stdout` and `stderr`)
- `metadata.json` (required)

Optional:

- Human summary markdown (`result.md`)

### Artifact location

- Repo-local durable storage: `.port/jobs/...`

Suggested layout:

```text
.port/jobs/
  index.json
  events/<task-id>.jsonl
  artifacts/<task-id>/
    metadata.json
    commit-refs.json
    changes.patch
    stdout.log
    stderr.log
```

Retention defaults:

- Completed: **30 days**
- Failed: **90 days**
- Retention configurable

---

## Apply/Cherry-pick Semantics

Default `port task apply <id>` strategy:

1. Cherry-pick commit refs
2. Fallback to bundle import path (if available)
3. Fallback to patch apply

Rules:

- Require clean working tree by default before apply.
- Preserve commit series by default.
- `--squash` optional for flattened apply.
- On conflicts: stop and let user resolve manually.

---

## Notifications and OpenCode Integration

- Per-task immediate notifications for progress/completion/error.
- Integration is an optional adapter/plugin layer, not hard-coupled into scheduler core.
- Core scheduler remains usable from pure CLI.

---

## Configuration

Config remains in `.port/config.jsonc` with two namespaces:

- `task` for scheduler/runtime/retention/concurrency behavior
- `remote` for adapter/backends and remote execution settings

Example shape:

```jsonc
{
  "task": {
    "timeoutMinutes": 30,
    "daemonIdleStopMinutes": 10,
    "requireCleanApply": true,
    "retentionDays": {
      "completed": 30,
      "failed": 90,
    },
    "lockMode": "branch",
    "applyMethod": "auto",
  },
  "remote": {
    "adapter": "local",
    "adapters": {
      "stub": {
        "enabled": true,
      },
    },
  },
}
```

Security default:

- Worker env passthrough is deny-by-default allowlist.

---

## Implementation Plan

### Phase 1: Core Engine + Local Adapter

- Task registry/index + event log persistence.
- Daemon process with queue + state machine.
- Local adapter implementation using ephemeral worktrees.
- Branch lock manager.
- Basic CLI (`start/list/read/logs/cancel/wait`).

### Phase 2: Artifacts + Apply

- Artifact collection pipeline (refs + patch + logs + metadata).
- `task artifacts` and `task apply` with auto fallback chain.
- Clean-tree enforcement and conflict-stop behavior.

### Phase 3: UX + Notifications

- `task watch` live table + `--logs` mode.
- Per-task immediate notifications.
- Optional OpenCode notification adapter.

### Phase 4: Remote Scaffold

- Adapter registry and capability model.
- Stub remote adapter wired through shared interface.
- `port remote adapters/status/doctor`.

---

## Risks and Mitigations

- Daemon orphaning
  - Mitigate with heartbeat, PID locks, idle stop, cleanup on startup.
- Artifact drift across adapters
  - Mitigate with strict required artifact contract and adapter capability checks.
- Apply conflicts and partial state
  - Mitigate with clean-tree precheck and stop-on-conflict.
- Remote complexity creep
  - Mitigate by freezing interface first and deferring transport decisions.

---

## Acceptance Criteria (v2)

1. User can launch multiple background tasks and continue working immediately.
2. Tasks survive daemon restart and can be listed/read with durable artifacts.
3. Write tasks always produce required artifacts (`commit refs`, `patch`, `logs`, `metadata.json`).
4. `port task apply` works with auto fallback and preserves commit series by default.
5. Branch lock queueing prevents concurrent write-task collisions on same branch.
6. Daemon auto-starts, idles out at 10 minutes, and can be cleaned up predictably.
7. Adapter registry + stub adapter exists, using the same interface as local adapter.

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
- Resume model: **adapter-native checkpoint/restore**, not one global graph format.
- Resume retention: **indefinite by default** (bounded by configurable retention only).
- v3 direction (design now, implement later): **attach/handoff workflow** for interactive steering.

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

v3-directed control-plane additions (forward-compatible in v2 schema/interface design):

- `port task attach <id>`
- `port task pause <id>`
- `port task resume <id>`

Resume behavior contract (locked):

- `resume` always restarts background processing.
- If task is `running` or `waiting_on_children`, it continues from checkpoint.
- If task is terminal (`completed|failed|timeout|cancelled`), it remains terminal and `resume` is a no-op with guidance to attach/read/apply.

### `port remote` commands (v2 scaffold)

- `port remote adapters`
- `port remote status`
- `port remote doctor`

Notes:

- Remote transport choice is intentionally deferred.
- v2 ships adapter registry + interface + stub adapter.
- Attach/handoff transport direction is WebSocket stream, but v2 only reserves contracts/state.

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
    supportsAttachHandoff: boolean
    supportsResumeToken: boolean
    supportsTranscript: boolean
    supportsFailedSnapshot: boolean
    supportsCheckpoint: boolean
    supportsRestore: boolean
  }

  prepare(job: JobSpec): Promise<PreparedExecution>
  start(prepared: PreparedExecution): Promise<RunHandle>
  status(handle: RunHandle): Promise<RunStatus>
  stream(handle: RunHandle): AsyncIterable<RunEvent>
  cancel(handle: RunHandle): Promise<void>
  collect(handle: RunHandle): Promise<CollectedArtifacts>
  cleanup(prepared: PreparedExecution): Promise<void>

  // Adapter-native continuity contract (required)
  checkpoint(handle: RunHandle): Promise<CheckpointRef>
  restore(checkpoint: CheckpointRef): Promise<RunHandle>

  // v3-directed (interface reserved now; implementation can be no-op/stub in v2)
  requestHandoff(handle: RunHandle): Promise<HandoffReady>
  attachContext(handle: RunHandle): Promise<AttachContext>
  resumeFromAttach(handle: RunHandle, token: ResumeToken): Promise<void>
}
```

This contract is the boundary that makes local and future remote execution swappable.

Important:

- Port scheduler stores universal orchestration state (status, lineage, locks, artifact pointers).
- Adapter stores execution-native workflow position (OpenCode session continuation, graph cursor, etc.).
- For OpenCode adapters, checkpoint/restore should preserve `opencode --continue` compatibility.

---

## Task State Machine

- `queued`
- `preparing`
- `running`
- `waiting_on_children`
- `resumable`
- `resuming`
- `paused_for_attach` (non-terminal; timeout paused)
- terminal: `completed | failed | timeout | cancelled`
- `cleaned` (post-terminal cleanup completion marker)

Additional non-terminal error substate (v3-directed):

- `resume_failed` (resume attempt after detach/client crash failed; task remains recoverable)

Defaults:

- Task timeout: **30 minutes**
- Retries: **none by default**
- Write tasks targeting same branch: **queued automatically**
- Attach idle timeout target (v3): **15 minutes**
- Reconnect grace target (v3): **2 minutes**

Lineage requirement:

- Parent/child dependencies are persisted.
- Parent can auto-transition to `waiting_on_children` and later become `resumable` when children finish.

---

## Artifacts and Retention

### Required write-task artifacts

- Commit refs manifest
- Patch file
- Logs (`stdout` and `stderr`)
- `metadata.json` (required)

Optional:

- Human summary markdown (`result.md`)
- Attach artifacts (v3): transcript/logs + handoff metadata + detach patch
- Checkpoint artifacts: adapter checkpoint references and restore metadata

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
    attach/
      session.json
      lifecycle.jsonl
      commands.log
      io.log
      detach.patch
      snapshot.tar
      snapshot.manifest.json
    checkpoint.json
    lineage.json
```

Retention defaults:

- Completed: **30 days**
- Failed: **90 days**
- Retention configurable
- Attach transcripts follow task retention defaults
- Checkpoints follow task retention defaults and are resumable indefinitely while retained

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
    "attach": {
      "enabled": true,
      "client": "configured",
      "idleTimeoutMinutes": 15,
      "reconnectGraceSeconds": 120,
      "autoResumeOnDetach": true,
      "pauseAtBoundary": "tool_return",
      "stateLabel": "paused_for_attach",
      "transcriptLevel": "full",
    },
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
- Attach transcript redaction defaults to strict env-value masking.

---

## Implementation Plan

### Phase 1: Core Engine + Local Adapter

- Task registry/index + event log persistence.
- Daemon process with queue + state machine.
- Local adapter implementation using ephemeral worktrees.
- Branch lock manager.
- Basic CLI (`start/list/read/logs/cancel/wait`).
- Reserve task schema fields for attach/handoff metadata (no behavior required in v2).

### Phase 2: Artifacts + Apply

- Artifact collection pipeline (refs + patch + logs + metadata).
- `task artifacts` and `task apply` with auto fallback chain.
- Clean-tree enforcement and conflict-stop behavior.

### Phase 3: UX + Notifications

- `task watch` live table + `--logs` mode.
- Per-task immediate notifications.
- Optional OpenCode notification adapter.
- `task resume` command wired to checkpoint/restore flow.

### Phase 4: Remote Scaffold

- Adapter registry and capability model.
- Stub remote adapter wired through shared interface.
- `port remote adapters/status/doctor`.
- Reserve attach/handoff interface hooks and capability flags across local + stub adapters.
- Ensure `task read`/`task list` can surface attach-related state fields without extra command surface.
- Validate adapter checkpoint/restore parity (local + stub remote) via contract tests.

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
- Interactive handoff race conditions
  - Mitigate with safe-boundary handoff (`tool_return`), single attacher lock, explicit takeover rules.
- Transcript/security exposure
  - Mitigate with strict redaction defaults, transcript levels, and retention controls.

---

## Acceptance Criteria (v2)

1. User can launch multiple background tasks and continue working immediately.
2. Tasks survive daemon restart and can be listed/read with durable artifacts.
3. Write tasks always produce required artifacts (`commit refs`, `patch`, `logs`, `metadata.json`).
4. `port task apply` works with auto fallback and preserves commit series by default.
5. Branch lock queueing prevents concurrent write-task collisions on same branch.
6. Daemon auto-starts, idles out at 10 minutes, and can be cleaned up predictably.
7. Adapter registry + stub adapter exists, using the same interface as local adapter.
8. v2 persistence and adapter contracts include forward-compatible attach/handoff fields and capability flags without requiring interactive runtime support yet.
9. `port task resume` uses adapter restore checkpoints for non-terminal tasks and preserves terminal-state semantics.

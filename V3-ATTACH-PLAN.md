# Port v3 Plan: Task Attach and Interactive Handoff

## Version

- Plan version: **v3.0**
- Status: **Draft locked for architecture**
- Depends on: `V2-PLAN.md` core scheduler, artifacts, adapter registry

---

## Objective

Add a first-class `attach` workflow so a user can take control of an in-flight background task, steer it interactively, and then return execution to the scheduler.

This plan standardizes a **handoff model** (not live multiplexed control of a single running process).

---

## Product Decisions (Locked)

- Primary command: `port task attach <id>`
- Control commands: `port task pause <id>`, `port task resume <id>`
- No `attach-status` command; attach state surfaces in `task read` and terse `task list`
- Access control: **job owner only**
- Concurrency: **one attacher at a time**
- Second attach receives lock error with owner/session details
- Takeover: `--force` immediately revokes current attach lock
- Attach to terminal tasks is rejected with actionable error
- Default attach transport direction: **WebSocket stream** (adapter-level)
- Default attach runtime model: **handoff to configured client**
- Client coupling: avoid hard dependency on OpenCode; launch configured attach client

---

## User Experience

### Commands

- `port task attach <id> [--force]`
- `port task pause <id>`
- `port task resume <id>`

### Attach behavior

1. User requests attach.
2. Task remains observable while scheduler waits for a safe boundary.
3. At boundary (after current tool call returns), scheduler checkpoints and yields control.
4. Task enters `paused_for_attach`.
5. `port` launches configured attach client with continuation context.
6. On client exit/crash, scheduler auto-resumes background execution.

### Resume behavior

- Resume is allowed from any owner session.
- If user edited files while attached, resumed agent must **replan from current workspace**.
- Task timeout is paused while attached and resumes when background execution resumes.

### Detach behavior

- Detach implies auto-resume by default.
- If auto-resume fails, task enters `resume_failed` (recoverable, non-terminal).

---

## State Model

### Task lifecycle additions

- `paused_for_attach` (non-terminal)
- `resume_failed` (non-terminal recoverable substate)

### Attach session lifecycle

- `pending_handoff`
- `handoff_ready`
- `client_attached`
- `reconnecting`
- `detached`
- `revoked`

Rules:

- Task must never finalize while in `paused_for_attach`.
- Terminal transition is blocked until resumed or cancelled.

---

## Scheduler Semantics

### Safe-boundary handoff

- Default boundary: `tool_return`
- If boundary is not reached in reasonable time, scheduler prompts with guidance and optional force-interrupt path.

### Locking

- Attach lock is separate from branch lock.
- Attach lock owner is job owner session.
- Branch lock behavior remains unchanged (held until task completion/cancel).

### Timeouts

- Attach idle timeout: 15 minutes
- Reconnect grace: 2 minutes
- Resume token lifetime: 30 minutes
- Task execution timeout pauses during `paused_for_attach`

---

## Adapter Contract

All adapters (local and remote) must support the same handoff semantics.

```ts
interface AttachCapableExecutionAdapter extends ExecutionAdapter {
  capabilities: {
    supportsAttachHandoff: true
    supportsResumeToken: true
    supportsTranscript: true
    supportsFailedSnapshot: true
  }

  requestHandoff(handle: RunHandle): Promise<HandoffReady>
  attachContext(handle: RunHandle): Promise<AttachContext>
  resumeFromAttach(handle: RunHandle, token: ResumeToken): Promise<void>
}
```

Adapter parity is a release requirement.

---

## Continuation and Client Neutrality

`port task attach` should launch a configured attach client, not a hard-coded OpenCode binary.

Config shape (illustrative):

```jsonc
{
  "task": {
    "attach": {
      "enabled": true,
      "client": {
        "command": "opencode --continue",
        "args": [],
        "env": {},
      },
    },
  },
}
```

If client launch fails, command returns actionable guidance for manual continuation.

---

## Persistence and Metadata

Minimum continuation metadata (locked):

- `sessionHandle`
- `workspaceRef`
- `checkpointId`
- `lockOwner`
- `resumeToken`
- `attachClientHint`

Attach details should appear in:

- `port task read <id>` (full)
- `port task list` (terse state label only)

---

## Artifacts, Audit, and Security

### Required attach artifacts

- `attach/session.json`
- `attach/lifecycle.jsonl`
- `attach/commands.log`
- `attach/io.log`
- `attach/detach.patch` (auto-captured on detach for write path)

### Failed-task requirement

- `attach/snapshot.tar`
- `attach/snapshot.manifest.json`

### Transcript policy

- Default transcript level: full command + output
- Levels configurable by policy
- Environment values are strictly redacted before persistence

### Retention

- Attach artifacts follow existing task retention windows

---

## Error Handling

- Attach on completed/failed/cancelled task: reject with clear message
- Missing resumable session: reject with actionable guidance (logs/artifacts path)
- Attach lock conflict: return lock holder + session info + `--force` option
- Repeated transport failure: fallback guidance to logs + snapshot artifacts
- Client crash: treated as detach; scheduler auto-resumes

---

## Performance Constraints

- Low runtime overhead when attach is unused
- No always-on debug channel for every task
- Create attach transport/session resources lazily at handoff time

---

## Acceptance Criteria

1. `port task attach` can hand off a running task at safe boundary and launch configured client.
2. Only job owner can attach; one active attacher at a time with force takeover support.
3. Background task auto-resumes after attach client exits or crashes.
4. Resume after interactive edits triggers replan from current workspace.
5. `paused_for_attach` and `resume_failed` states are surfaced via `task read` and `task list`.
6. Required attach artifacts and failed snapshot artifacts are produced with strict redaction.
7. Local and remote adapters pass parity tests for attach/handoff contract.
8. Reconnect and resume token behavior satisfies configured grace/TTL settings.
9. Attach path adds negligible overhead to tasks that are never attached.

---

## Implementation Workstreams

1. **Core Scheduler**
   - Add attach lock manager, handoff state transitions, timeout pause/resume logic, and `resume_failed` recovery paths.
2. **CLI Surface**
   - Implement `task attach|pause|resume` and enrich `task read/list` output.
3. **Adapter Layer**
   - Add handoff methods/capabilities and parity test harness across local + remote adapters.
4. **Persistence/Artifacts**
   - Add continuation metadata schema and attach artifact writers.
5. **Security/Audit**
   - Enforce owner-only attach, token TTL, transcript policy, and redaction.
6. **Reliability**
   - Reconnect handling, takeover semantics, safe-boundary waiting with operator guidance.

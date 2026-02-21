# OpenCode Checkpoint Compatibility

This document defines how checkpoint metadata supports `opencode --continue` while keeping restore behavior adapter-agnostic.

## Contract

`TaskCheckpointRef.payload` may include OpenCode metadata:

```ts
interface OpenCodeCheckpointMetadata {
  sessionId?: string
  transcriptPath?: string
  workspaceRef?: string
  fallbackSummary?: string
}
```

Fields:

- `sessionId`: OpenCode continuation handle. When present, restore uses native `--continue` mode.
- `transcriptPath`: Optional path to attach I/O transcript for debugging and replay context.
- `workspaceRef`: Preferred workspace path for resumed interactive sessions.
- `fallbackSummary`: Human-readable continuation brief when native session restore is unavailable.

## Restore Strategy

Port derives an OpenCode continue plan from checkpoint metadata.

1. If `sessionId` exists: use native continuation strategy.
   - command: `opencode --continue <sessionId>`
2. If `sessionId` is missing: use fallback summary strategy.
   - command: `opencode`
   - include summary context from `fallbackSummary`
   - if no explicit `fallbackSummary` exists, synthesize one from task id, run id, branch, and worktree path

Both strategies preserve the same Port task identity and continuation run lineage.

## Fallback Summary Requirements

Fallback summaries should include enough context to safely continue work:

- task id and run id
- workspace path and branch
- artifact location hint (`.port/jobs/artifacts/<task-id>`)

This keeps continuation usable even when exact OpenCode session restoration is not possible.

## Tests

Coverage is in `src/lib/taskAdapter.test.ts`:

- native restore path: checkpoint with `sessionId` resolves to `native_session`
- fallback path: checkpoint without `sessionId` resolves to `fallback_summary`

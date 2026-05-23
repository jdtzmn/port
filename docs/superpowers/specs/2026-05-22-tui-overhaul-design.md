# TUI Overhaul Design

> Approval gates are part of this design. Stop after each phase and wait for review before starting the next phase.

**Goal:** Replace the current TUI with a cleaner two-pane layout that supports independent worktree operations, service actions, live logs for long-running commands, and a compact, context-aware keymap.

**Core rules:**
- Two panes are always visible.
- The selected pane is visually brighter.
- The shared middle divider is always bright.
- `h` / `l` move focus between panes.
- `H` / `L` resize the split left and right.
- `[` / `]` are not used for resizing.
- Long-running worktree operations automatically swap the right pane into a terminal/log view for the active worktree.
- Successful long-running operations auto-return to services.
- Errors stay visible until `Esc`.
- Operations run independently; `up` and `down` work across multiple worktrees in parallel.

## Layout

Use a minimal bordered layout with titles embedded in the top border.

Example shape:

```text
+----------- Worktrees ---------+----------- Services ----------+
|                               |                               |
|                               |                               |
+-------------------------------+-------------------------------+
```

Rules:
- Left pane: worktrees.
- Right pane: services for the selected worktree, or the live terminal/log view while a long-running operation is active.
- Both panes scroll independently.
- The focused pane gets a brighter outer border.
- The unfocused pane stays dimmer.
- The middle divider remains bright at all times.

## State Model

The TUI needs three concurrent state layers:

1. **Pane focus state**
   - Which pane is active.
   - Used for keyboard routing and border emphasis.

2. **Selection state**
   - Selected worktree in the left pane.
   - Selected service in the right pane when the right pane is in services mode.
   - Scroll positions for both panes.

3. **Operation state**
   - Per-worktree command state for running operations.
   - A worktree can be idle, running, success, or error.
   - Running state can force the right pane into the live terminal/log view.

Service reconciliation:
- Docker state changes are polled, not inferred only from Port commands.
- Poll the selected/visible worktree's service state every `3s`.
- Poll inactive worktrees every `10s`.
- This polling is for detecting external Docker state changes, not for the normal UI render loop.

Worktree ordering:
- Active or partially active worktrees first.
- Then other worktrees in the same logical group.
- Then everything else.
- Within each group, sort by most recently interacted with.
- If the active worktree is not running, keep it at the top of the inactive group.

## Phases

### Phase 1: Layout and Divider Behavior

Deliverables:
- Two-pane shell with embedded titles.
- Scrollable panes.
- Focus highlight on pane borders.
- `h` / `l` pane switching.
- `H` / `L` split resizing.
- `q`, `Esc`, and arrow-key navigation basics.

Test gate:
- Add or update layout tests for border styling, split resizing, pane focus, and scrollable shell behavior.
- Run those tests and confirm they fail before implementation, then pass after.

Approval gate:
- Confirm the pane look, border emphasis, and divider resizing before anything else changes.

### Phase 2: Worktree Model and Sorting

Deliverables:
- New worktree list ordering.
- Worktree selection and scroll preservation.
- Row state for idle / running / success / error.
- Clear active-worktree marker.

Test gate:
- Add or update tests for ordering, selection retention, and row-state rendering before implementation.
- Run them and confirm they gate the phase.

Approval gate:
- Confirm the ordering rules and row states.

### Phase 3: Worktree Actions

Deliverables:
- `space` set active.
- `n` create a worktree.
- `u` bring selected services up.
- `d` archive/delete.
- `r` rename/move.
- `U` bring the whole worktree up.
- `D` bring the whole worktree down.
- `/` filter worktrees.
- Concurrent execution across worktrees.

Test gate:
- Add or update interaction tests for the worktree actions, modal flows, and parallel op handling before implementation.
- Run them and confirm they fail first, then pass.

Approval gate:
- Confirm the worktree action flow and concurrency behavior.

### Phase 4: Services Pane

Deliverables:
- Services for the selected worktree.
- `Enter` tails the selected service logs in the right pane.
- `o` opens ports, with a picker when a service has multiple ports.
- `u` / `d` service up/down.
- `/` filter services.
- Scrollable service list with per-service status dots.

Test gate:
- Add or update tests for service selection, port picker behavior, and service filtering before implementation.
- Run them and confirm they gate the phase.

Approval gate:
- Confirm the service-pane interaction model.

### Phase 5: Live Terminal / Logs View

Deliverables:
- Right pane swaps to the active worktree’s live command output when a long-running operation is in progress.
- Success returns to services automatically.
- Error stays in the terminal view until `Esc`.
- `Enter`-launched service logs use the same right-pane swap pattern.

Test gate:
- Add or update tests for log swap, auto-return on success, and pinned error state before implementation.
- Run them and confirm they fail before the feature exists.

Approval gate:
- Confirm the live-output behavior and error handling.

### Phase 6: Key Hints, Help, and Polish

Deliverables:
- Context-aware key hint row.
- `?` shows the full command list for the current state.
- Modal-specific hints.
- Clean handling of special states and empty states.

Test gate:
- Add or update tests for the dynamic hint row and help overlay before implementation.
- Run them and confirm they gate the polish phase.

Approval gate:
- Confirm the final keymap presentation.

## Testing Strategy

OpenTUI `testRender` and `captureCharFrame` are the default UI test tools.

Rules:
- Write tests before each phase’s implementation.
- Run the phase tests and confirm they fail before the code change.
- Only move to the next phase after the current phase tests pass and the user approves the result.
- Keep one manual smoke pass at the end for resize, divider movement, and live logs.
- Keep Docker reconciliation polling on the 3s / 10s cadence above so stale service state corrects itself even when Port did not initiate the change.

Coverage to keep across the phases:
- Pane borders and focus emphasis.
- Split resizing.
- Pane switching.
- Worktree filtering and sorting.
- Services filtering and service opening.
- Long-running operation swap to logs.
- Auto-return on success.
- Error pinning until `Esc`.
- Concurrent `up` / `down` worktree operations.

## Non-Goals

- No separate full-screen logs mode.
- No `L` logs toggle.
- No retry flow in this PR.
- No broad backend refactor beyond what the UI needs.

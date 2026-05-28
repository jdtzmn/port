# Better TUI Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing `TuiShell` regression coverage for `/` so the shell still routes filter input into the active pane in both worktrees and services.

**Architecture:** Keep this phase test-only unless the new coverage reveals a real shell-routing bug. Use the existing OpenTUI `testRender` harness in `src/tui/__tests__/TuiShell.test.tsx` to drive the shell exactly the way a user would: press `/` in the active pane, type a query, switch panes with `l`, and assert on the rendered frame and spans that each pane's own filter UI still receives the input.

**Tech Stack:** TypeScript, Bun test, OpenTUI test utils

---

### Task 1: Add shell-level `/` routing coverage

**Files:**
- Modify: `src/tui/__tests__/TuiShell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add one test that proves the shell forwards `/` to the active pane instead of swallowing it:

```ts
import { RGBA } from '@opentui/core'

async function pressAndRender(
  mockInput: { pressKey: (key: string) => void },
  renderOnce: () => Promise<void>,
  key: string
) {
  mockInput.pressKey(key)
  await new Promise(resolve => setTimeout(resolve, 50))
  await renderOnce()
}

test('slash reaches the active pane filter handlers in both panes', async () => {
  const { renderer, mockInput, renderOnce, captureCharFrame, captureSpans } = await testRender(
    <TuiShell
      repoRoot="/repo"
      repoName="myapp"
      worktrees={mockWorktrees}
      hostServices={[] as HostService[]}
      traefikRunning={true}
      config={mockConfig}
      activeWorktreeName="myapp"
      actions={mockActions}
      refresh={noop}
      loading={false}
      statusMessage={null}
      showStatus={noop}
      requestExit={noop}
    />,
    { width: 96, height: 24 }
  )
  currentRenderer = renderer

  await renderOnce()
  mockInput.pressKey('/')
  await new Promise(resolve => setTimeout(resolve, 50))
  await renderOnce()

  let frame = captureCharFrame()
  expect(frame).toContain('/ (type to filter)')

  await pressAndRender(mockInput, renderOnce, 'a')
  await pressAndRender(mockInput, renderOnce, 'u')
  await pressAndRender(mockInput, renderOnce, 't')
  await pressAndRender(mockInput, renderOnce, 'h')
  mockInput.pressEnter()
  await new Promise(resolve => setTimeout(resolve, 50))
  await renderOnce()

  frame = captureCharFrame()
  expect(frame).toContain('/auth')

  mockInput.pressKey('l')
  await new Promise(resolve => setTimeout(resolve, 50))
  await renderOnce()

  mockInput.pressKey('/')
  await new Promise(resolve => setTimeout(resolve, 50))
  await renderOnce()

  await pressAndRender(mockInput, renderOnce, 'a')
  await pressAndRender(mockInput, renderOnce, 'p')
  await pressAndRender(mockInput, renderOnce, 'i')

  const spans = captureSpans()
  expect(
    spans.lines.some(line =>
      line.spans.some(span => span.text.includes('api') && span.fg.equals(RGBA.fromHex('#00AAFF')))
    )
  ).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui/__tests__/TuiShell.test.tsx`
Expected: FAIL until the shell-level `/` path is covered by the test.

- [ ] **Step 3: Make the minimal code change if needed**

If the new test fails, inspect `src/tui/views/TuiShell.tsx` and keep the shell from intercepting `/` before the active pane handlers see it. The fix should stay in the shell keyboard-routing code; do not touch the pane filter logic unless the failure proves the bug lives there.

- [ ] **Step 4: Run the test again**

Run: `bun test src/tui/__tests__/TuiShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/__tests__/TuiShell.test.tsx src/tui/views/TuiShell.tsx docs/superpowers/plans/2026-05-27-better-tui-phase-2.md
git commit -m "docs: add better tui phase 2 plan"
```

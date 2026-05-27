import { test, expect, describe } from 'bun:test'
import { DEFAULT_TUI_INTERACTION_STATE } from '../lib/interaction.tsx'
import { fitKeyHintsToWidth, getFooterHintsForState } from '../lib/commands.ts'

describe('command registry footer', () => {
  test('keeps ? toggle help pinned at the end when truncating', () => {
    const state = {
      ...DEFAULT_TUI_INTERACTION_STATE,
      panes: {
        ...DEFAULT_TUI_INTERACTION_STATE.panes,
        worktrees: { mode: 'query' as const },
      },
    }

    const hints = getFooterHintsForState(state)
    const fitted = fitKeyHintsToWidth(hints, 60)

    expect(fitted.at(-1)).toEqual({ key: '?', action: 'toggle help' })
    expect(fitted.some(hint => hint.key === 'Type')).toBe(true)
  })

  test('exposes confirm hints when an action is pending', () => {
    const state = {
      ...DEFAULT_TUI_INTERACTION_STATE,
      pendingAction: 'archive' as const,
    }

    const hints = getFooterHintsForState(state)

    expect(hints.some(hint => hint.key === 'y' && hint.action === 'confirm')).toBe(true)
    expect(hints.some(hint => hint.key === 'n' && hint.action === 'cancel')).toBe(true)
    expect(hints.at(-1)).toEqual({ key: '?', action: 'toggle help' })
  })
})

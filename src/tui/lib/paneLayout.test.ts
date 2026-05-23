import { describe, expect, test } from 'bun:test'
import {
  adjustSplitPercent,
  computePaneWidths,
  getPaneChrome,
  resolveShellPaneKey,
} from './paneLayout.ts'

describe('paneLayout', () => {
  test('computes pane widths from the split percentage', () => {
    expect(computePaneWidths(120, 0.5)).toEqual({
      leftWidth: 60,
      dividerWidth: 0,
      rightWidth: 60,
    })
  })

  test('keeps the split percentage within bounds when resizing', () => {
    expect(adjustSplitPercent(0.5, 'left')).toBe(0.45)
    expect(adjustSplitPercent(0.5, 'right')).toBe(0.55)
    expect(adjustSplitPercent(0.02, 'left')).toBe(0.1)
    expect(adjustSplitPercent(0.98, 'right')).toBe(0.9)
  })

  test('maps the active pane to bright and dim chrome tones', () => {
    expect(getPaneChrome('worktrees')).toEqual({
      leftTone: 'bright',
      rightTone: 'dim',
      dividerTone: 'bright',
    })

    expect(getPaneChrome('services')).toEqual({
      leftTone: 'dim',
      rightTone: 'bright',
      dividerTone: 'bright',
    })
  })

  test('routes lowercase navigation keys to the other pane', () => {
    expect(resolveShellPaneKey('worktrees', 'l')).toBe('services')
    expect(resolveShellPaneKey('services', 'h')).toBe('worktrees')
    expect(resolveShellPaneKey('worktrees', 'ArrowRight')).toBe('services')
    expect(resolveShellPaneKey('services', 'ArrowLeft')).toBe('worktrees')
  })

  test('routes uppercase keys to split resizing', () => {
    expect(resolveShellPaneKey('worktrees', 'H')).toBe('resize-left')
    expect(resolveShellPaneKey('services', 'L')).toBe('resize-right')
  })
})

export type ActivePane = 'worktrees' | 'services'

export type PaneTone = 'bright' | 'dim'

export type ShellPaneAction = ActivePane | 'resize-left' | 'resize-right' | null

const MIN_SPLIT = 0.1
const MAX_SPLIT = 0.9
const SPLIT_STEP = 0.05
const MIN_PANE_WIDTH = 24

export function computePaneWidths(totalWidth: number, splitPercent: number) {
  const safeWidth = Math.max(totalWidth, MIN_PANE_WIDTH * 2)
  const clampedSplit = clampSplitPercent(splitPercent)
  const available = safeWidth
  let leftWidth = Math.round(available * clampedSplit)
  let rightWidth = available - leftWidth

  if (leftWidth < MIN_PANE_WIDTH) {
    leftWidth = MIN_PANE_WIDTH
    rightWidth = available - leftWidth
  }

  if (rightWidth < MIN_PANE_WIDTH) {
    rightWidth = MIN_PANE_WIDTH
    leftWidth = available - rightWidth
  }

  return {
    leftWidth,
    dividerWidth: 0,
    rightWidth,
  }
}

export function adjustSplitPercent(splitPercent: number, direction: 'left' | 'right'): number {
  const delta = direction === 'left' ? -SPLIT_STEP : SPLIT_STEP
  return clampSplitPercent(splitPercent + delta)
}

export function getPaneChrome(activePane: ActivePane) {
  return activePane === 'worktrees'
    ? { leftTone: 'bright' as const, rightTone: 'dim' as const, dividerTone: 'bright' as const }
    : { leftTone: 'dim' as const, rightTone: 'bright' as const, dividerTone: 'bright' as const }
}

export function resolveShellPaneKey(
  activePane: ActivePane,
  keyName: string,
  shiftPressed = false
): ShellPaneAction {
  switch (keyName) {
    case 'h':
    case 'ArrowLeft':
      if (shiftPressed) return 'resize-left'
      return 'worktrees'
    case 'l':
    case 'ArrowRight':
      if (shiftPressed) return 'resize-right'
      return 'services'
    case 'H':
      return 'resize-left'
    case 'L':
      return 'resize-right'
    default:
      return null
  }
}

function clampSplitPercent(splitPercent: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, splitPercent))
}

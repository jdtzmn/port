import type { KeyHint } from '../components/KeyHints.tsx'
import type { HelpSection } from '../components/HelpDialog.tsx'
import type { TuiInteractionState, TuiPaneMode, TuiPane } from './interaction.tsx'

type CommandWhen = (state: TuiInteractionState) => boolean

interface CommandDefinition {
  key: string
  action: string
  section: string
  footer: boolean
  when: CommandWhen
}

function always(): CommandWhen {
  return () => true
}

function paneMode(pane: TuiPane, mode: TuiPaneMode): CommandWhen {
  return state => state.activePane === pane && state.panes[pane].mode === mode
}

function anyMode(mode: TuiPaneMode): CommandWhen {
  return state => state.panes[state.activePane].mode === mode
}

const COMMANDS: CommandDefinition[] = [
  {
    key: 'Type',
    action: 'type filter text',
    section: 'Filter',
    footer: true,
    when: anyMode('query'),
  },
  { key: 'Backspace', action: 'delete', section: 'Filter', footer: true, when: anyMode('query') },
  { key: 'Enter', action: 'apply filter', section: 'Filter', footer: true, when: anyMode('query') },
  { key: 'Esc', action: 'cancel', section: 'Filter', footer: true, when: anyMode('query') },
  {
    key: 'j/k',
    action: 'next/prev match',
    section: 'Filter',
    footer: true,
    when: anyMode('filtered-nav'),
  },
  {
    key: '/',
    action: 'edit filter',
    section: 'Filter',
    footer: true,
    when: anyMode('filtered-nav'),
  },
  {
    key: 'Esc',
    action: 'clear filter',
    section: 'Filter',
    footer: true,
    when: anyMode('filtered-nav'),
  },
  {
    key: 'Enter',
    action: 'inspect selected worktree',
    section: 'Worktrees',
    footer: true,
    when: paneMode('worktrees', 'normal'),
  },
  {
    key: 'o',
    action: 'open selected worktree',
    section: 'Worktrees',
    footer: true,
    when: paneMode('worktrees', 'normal'),
  },
  {
    key: '/',
    action: 'filter worktrees',
    section: 'Worktrees',
    footer: true,
    when: paneMode('worktrees', 'normal'),
  },
  {
    key: 'u',
    action: 'bring selected services up',
    section: 'Worktrees',
    footer: true,
    when: paneMode('worktrees', 'normal'),
  },
  {
    key: 'd',
    action: 'bring selected services down',
    section: 'Worktrees',
    footer: true,
    when: paneMode('worktrees', 'normal'),
  },
  {
    key: 'a',
    action: 'archive selected worktree',
    section: 'Worktrees',
    footer: true,
    when: paneMode('worktrees', 'normal'),
  },
  {
    key: 'r',
    action: 'refresh',
    section: 'Worktrees',
    footer: true,
    when: paneMode('worktrees', 'normal'),
  },
  {
    key: 'Enter',
    action: 'open selected service',
    section: 'Services',
    footer: true,
    when: paneMode('services', 'normal'),
  },
  {
    key: '/',
    action: 'filter services',
    section: 'Services',
    footer: true,
    when: paneMode('services', 'normal'),
  },
  {
    key: 'd',
    action: 'bring worktree down',
    section: 'Services',
    footer: true,
    when: paneMode('services', 'normal'),
  },
  {
    key: 'x',
    action: 'kill host service',
    section: 'Services',
    footer: true,
    when: paneMode('services', 'normal'),
  },
  {
    key: 'Esc',
    action: 'cancel',
    section: 'Confirm',
    footer: true,
    when: state => Boolean(state.pendingAction),
  },
  {
    key: 'y',
    action: 'confirm',
    section: 'Confirm',
    footer: true,
    when: state => Boolean(state.pendingAction),
  },
  {
    key: 'n',
    action: 'cancel',
    section: 'Confirm',
    footer: true,
    when: state => Boolean(state.pendingAction),
  },
  {
    key: 'Type',
    action: 'search commands',
    section: 'Palette',
    footer: true,
    when: state => state.palette.open,
  },
  {
    key: 'Enter',
    action: 'run',
    section: 'Palette',
    footer: true,
    when: state => state.palette.open,
  },
  {
    key: 'Esc',
    action: 'close palette',
    section: 'Palette',
    footer: true,
    when: state => state.palette.open,
  },
  { key: 'q', action: 'quit', section: 'Shared', footer: true, when: always() },
  { key: '?', action: 'toggle help', section: 'Shared', footer: true, when: always() },
  { key: 'h', action: 'focus worktrees', section: 'Layout', footer: false, when: always() },
  { key: 'l', action: 'focus services', section: 'Layout', footer: false, when: always() },
  { key: 'H', action: 'resize left', section: 'Layout', footer: false, when: always() },
  { key: 'L', action: 'resize right', section: 'Layout', footer: false, when: always() },
]

export function getVisibleCommands(state: TuiInteractionState): CommandDefinition[] {
  return COMMANDS.filter(command => command.when(state))
}

export function getFooterHintsForState(state: TuiInteractionState): KeyHint[] {
  const hints = getVisibleCommands(state)
    .filter(command => command.footer)
    .map(command => ({ key: command.key, action: command.action }))

  const helpIndex = hints.findIndex(hint => hint.key === '?')
  if (helpIndex >= 0) {
    const [help] = hints.splice(helpIndex, 1)
    if (help) hints.push(help)
  }

  return hints
}

export function estimateHintWidth(hint: KeyHint): number {
  return hint.key.length + 1 + hint.action.length
}

export function fitKeyHintsToWidth(hints: KeyHint[], maxWidth: number): KeyHint[] {
  if (hints.length === 0) return []
  if (maxWidth <= 0) return [hints[hints.length - 1]!]

  const lastHint = hints[hints.length - 1]!
  const visible = hints.slice(0, -1)

  const totalWidth = (items: KeyHint[]) =>
    items.reduce((sum, hint, index) => sum + estimateHintWidth(hint) + (index > 0 ? 2 : 0), 0)

  let kept: KeyHint[] = []
  for (const hint of visible) {
    const candidate = [...kept, hint, lastHint]
    if (totalWidth(candidate) <= maxWidth) {
      kept = [...kept, hint]
    } else {
      break
    }
  }

  return [...kept, lastHint]
}

export function getHelpSectionsForState(state: TuiInteractionState): HelpSection[] {
  const visible = getVisibleCommands(state)
  const focusSection = state.pendingAction
    ? 'Confirm'
    : state.palette.open
      ? 'Palette'
      : state.panes[state.activePane].mode === 'query' ||
          state.panes[state.activePane].mode === 'filtered-nav'
        ? 'Filter'
        : state.activePane === 'worktrees'
          ? 'Worktrees'
          : 'Services'

  const sectionPriority = new Map<string, number>([
    [focusSection, 0],
    ['Shared', 1],
    ['Layout', 2],
  ])
  const sectionOrder = new Map<string, number>()
  const sections = new Map<string, KeyHint[]>()

  for (const command of visible) {
    const existing = sections.get(command.section)
    if (existing) {
      existing.push({ key: command.key, action: command.action })
    } else {
      sectionOrder.set(command.section, sectionOrder.size)
      sections.set(command.section, [{ key: command.key, action: command.action }])
    }
  }

  return [...sections.entries()]
    .sort((a, b) => {
      const priorityDiff = (sectionPriority.get(a[0]) ?? 10) - (sectionPriority.get(b[0]) ?? 10)
      if (priorityDiff !== 0) return priorityDiff
      return (sectionOrder.get(a[0]) ?? 0) - (sectionOrder.get(b[0]) ?? 0)
    })
    .map(([title, items]) => ({ title, items }))
}

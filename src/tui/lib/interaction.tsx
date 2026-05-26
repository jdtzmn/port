import { createContext, useContext } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { KeyHint } from '../components/KeyHints.tsx'

export type TuiPane = 'worktrees' | 'services'

export type TuiPaneMode = 'normal' | 'query' | 'filtered-nav' | 'confirm' | 'operation' | 'logs'

export type TuiPendingAction = 'archive' | null

export interface TuiPaletteState {
  open: boolean
  query: string
  selectedIndex: number
}

export interface TuiPaneState {
  mode: TuiPaneMode
}

export interface TuiInteractionState {
  activePane: TuiPane
  helpOpen: boolean
  pendingAction: TuiPendingAction
  palette: TuiPaletteState
  panes: Record<TuiPane, TuiPaneState>
}

export type TuiInteractionAction =
  | { type: 'set-active-pane'; pane: TuiPane }
  | { type: 'set-pane-mode'; pane: TuiPane; mode: TuiPaneMode }
  | { type: 'toggle-help' }
  | { type: 'close-help' }
  | { type: 'begin-confirm'; action: Exclude<TuiPendingAction, null> }
  | { type: 'end-confirm' }
  | { type: 'open-palette' }
  | { type: 'close-palette' }
  | { type: 'set-palette-query'; query: string }
  | { type: 'set-palette-selected-index'; selectedIndex: number }

export const DEFAULT_TUI_INTERACTION_STATE: TuiInteractionState = {
  activePane: 'worktrees',
  helpOpen: false,
  pendingAction: null,
  palette: {
    open: false,
    query: '',
    selectedIndex: 0,
  },
  panes: {
    worktrees: { mode: 'normal' },
    services: { mode: 'normal' },
  },
}

const noopDispatch: Dispatch<TuiInteractionAction> = () => {}

export const TuiInteractionContext = createContext<{
  state: TuiInteractionState
  dispatch: Dispatch<TuiInteractionAction>
} | null>(null)

export function useTuiInteraction() {
  return useContext(TuiInteractionContext) ?? {
    state: DEFAULT_TUI_INTERACTION_STATE,
    dispatch: noopDispatch,
  }
}

export function tuiInteractionReducer(
  state: TuiInteractionState,
  action: TuiInteractionAction
): TuiInteractionState {
  switch (action.type) {
    case 'set-active-pane':
      if (state.activePane === action.pane) return state
      return { ...state, activePane: action.pane }
    case 'set-pane-mode':
      if (state.panes[action.pane].mode === action.mode) return state
      return {
        ...state,
        panes: {
          ...state.panes,
          [action.pane]: { mode: action.mode },
        },
      }
    case 'toggle-help':
      return { ...state, helpOpen: !state.helpOpen }
    case 'close-help':
      if (!state.helpOpen) return state
      return { ...state, helpOpen: false }
    case 'begin-confirm':
      if (state.pendingAction === action.action) return state
      return { ...state, pendingAction: action.action }
    case 'end-confirm':
      if (state.pendingAction === null) return state
      return { ...state, pendingAction: null }
    case 'open-palette':
      if (state.palette.open) return state
      return {
        ...state,
        palette: {
          ...state.palette,
          open: true,
        },
      }
    case 'close-palette':
      if (!state.palette.open && state.palette.query === '' && state.palette.selectedIndex === 0) {
        return state
      }
      return {
        ...state,
        palette: {
          open: false,
          query: '',
          selectedIndex: 0,
        },
      }
    case 'set-palette-query':
      if (state.palette.query === action.query) return state
      return {
        ...state,
        palette: {
          ...state.palette,
          query: action.query,
        },
      }
    case 'set-palette-selected-index':
      if (state.palette.selectedIndex === action.selectedIndex) return state
      return {
        ...state,
        palette: {
          ...state.palette,
          selectedIndex: action.selectedIndex,
        },
      }
  }
}

export function isQuestionMarkKey(eventName: string, keySequence?: string, shift?: boolean): boolean {
  return keySequence === '?' || eventName === 'question' || (shift && eventName === 'slash')
}

export function getFooterHints(state: TuiInteractionState): KeyHint[] {
  if (state.pendingAction) {
    return [
      { key: 'y', action: 'confirm' },
      { key: 'n', action: 'cancel' },
      { key: 'Esc', action: 'cancel' },
    ]
  }

  if (state.palette.open) {
    return [
      { key: 'Type', action: 'search commands' },
      { key: 'Enter', action: 'run' },
      { key: 'Esc', action: 'close palette' },
    ]
  }

  const mode = state.panes[state.activePane].mode

  if (state.activePane === 'worktrees') {
    return mode === 'query'
      ? [
          { key: 'Type', action: 'filter' },
          { key: 'Backspace', action: 'delete' },
          { key: 'Enter', action: 'apply' },
          { key: 'Esc', action: 'cancel' },
        ]
      : mode === 'filtered-nav'
        ? [
            { key: 'j/k', action: 'next/prev match' },
            { key: '/', action: 'edit filter' },
            { key: 'Esc', action: 'clear filter' },
            { key: 'Enter', action: 'open in browser' },
          ]
        : [
            { key: 'Enter', action: 'inspect' },
            { key: 'o', action: 'open' },
            { key: '/', action: 'filter' },
            { key: 'u', action: 'up' },
            { key: 'd', action: 'down' },
            { key: 'a', action: 'archive' },
            { key: 'r', action: 'refresh' },
            { key: 'q', action: 'quit' },
          ]
  }

  return mode === 'query'
    ? [
        { key: 'Type', action: 'filter' },
        { key: 'Backspace', action: 'delete' },
        { key: 'Enter', action: 'apply' },
        { key: 'Esc', action: 'cancel' },
      ]
    : mode === 'filtered-nav'
      ? [
          { key: 'j/k', action: 'next/prev match' },
          { key: '/', action: 'edit filter' },
          { key: 'Esc', action: 'clear filter' },
          { key: 'Enter', action: 'inspect' },
          { key: 'o', action: 'open' },
        ]
      : [
          { key: 'Enter', action: 'open in browser' },
          { key: '/', action: 'filter' },
          { key: 'd', action: 'down' },
          { key: 'x', action: 'kill host svc' },
          { key: 'Esc', action: 'back' },
          { key: 'r', action: 'refresh' },
          { key: 'q', action: 'quit' },
        ]
}

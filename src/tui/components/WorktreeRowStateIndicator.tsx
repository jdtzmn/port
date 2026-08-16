export type WorktreeRowState = 'idle' | 'running' | 'success' | 'error'

interface WorktreeRowStateIndicatorProps {
  state: WorktreeRowState
}

export function WorktreeRowStateIndicator({ state }: WorktreeRowStateIndicatorProps) {
  switch (state) {
    case 'running':
      return <text fg="#FFD966">●</text>
    case 'success':
      return <text fg="#00FF00">●</text>
    case 'error':
      return <text fg="#FF4444">●</text>
    case 'idle':
    default:
      return <text fg="#666666">○</text>
  }
}

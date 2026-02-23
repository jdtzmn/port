interface StatusIndicatorProps {
  running: boolean
}

export function StatusIndicator({ running }: StatusIndicatorProps) {
  return running ? <text fg="#00FF00">●</text> : <text fg="#555555">○</text>
}

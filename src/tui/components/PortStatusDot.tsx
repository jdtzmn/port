interface PortStatusDotProps {
  status: 'unknown' | 'running' | 'stopped'
}

export function PortStatusDot({ status }: PortStatusDotProps) {
  if (status === 'unknown') {
    return <text fg="#FFD966">●</text>
  }

  return status === 'running' ? <text fg="#00FF00">●</text> : <text fg="#555555">○</text>
}

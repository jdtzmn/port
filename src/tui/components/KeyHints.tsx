export interface KeyHint {
  key: string
  action: string
}

interface KeyHintsProps {
  hints: KeyHint[]
}

export function KeyHints({ hints }: KeyHintsProps) {
  return (
    <box flexDirection="row" gap={2}>
      {hints.map(hint => (
        <text key={hint.key} fg="#888888">
          <b fg="#CCCCCC">[{hint.key}]</b> {hint.action}
        </text>
      ))}
    </box>
  )
}

export interface KeyHint {
  key: string
  action: string
}

interface KeyHintsProps {
  hints: KeyHint[]
}

export function KeyHints({ hints }: KeyHintsProps) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0}>
      {hints.map(hint => (
        <box key={`${hint.key}-${hint.action}`} flexShrink={0}>
          <text fg="#888888">
            <b fg="#CCCCCC">[{hint.key}]</b> {hint.action}
          </text>
        </box>
      ))}
    </box>
  )
}

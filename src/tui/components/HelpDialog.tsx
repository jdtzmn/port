import type { KeyHint } from './KeyHints.tsx'

interface HelpDialogProps {
  hints: KeyHint[]
}

export function HelpDialog({ hints }: HelpDialogProps) {
  const lines = [
    'Help',
    'Current commands',
    ...hints.map(hint => `${hint.key} ${hint.action}`),
    'Esc close help',
  ]

  return (
    <box flexDirection="column" borderStyle="rounded" borderColor="#555555" paddingX={1} paddingY={0}>
      <text fg="#888888" wrapMode="none">
        {lines.join('\n')}
      </text>
    </box>
  )
}

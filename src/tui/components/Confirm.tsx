import { useKeyboard } from '@opentui/react'

interface ConfirmProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function Confirm({ message, onConfirm, onCancel }: ConfirmProps) {
  useKeyboard(event => {
    if (event.name === 'y') {
      onConfirm()
    } else if (event.name === 'n' || event.name === 'escape') {
      onCancel()
    }
  })

  return (
    <box flexDirection="row" gap={1}>
      <text fg="#FFFF00">{message}</text>
      <text fg="#888888">[y/n]</text>
    </box>
  )
}

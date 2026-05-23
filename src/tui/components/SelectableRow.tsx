import type { ReactNode } from 'react'

export const SELECTED_ROW_BACKGROUND = '#333333'

interface SelectableRowProps {
  selected: boolean
  children: ReactNode
}

export function SelectableRow({ selected, children }: SelectableRowProps) {
  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      gap={1}
      overflow="hidden"
      backgroundColor={selected ? SELECTED_ROW_BACKGROUND : undefined}
    >
      {children}
    </box>
  )
}

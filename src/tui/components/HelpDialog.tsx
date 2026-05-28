import type { KeyHint } from './KeyHints.tsx'

export interface HelpSection {
  title: string
  items: KeyHint[]
}

interface HelpDialogProps {
  title: string
  sections: HelpSection[]
  width: number
}

const TITLE_COLOR = '#00AAFF'
const SECTION_COLOR = '#00AAFF'
const KEY_COLOR = '#FFAA00'
const TEXT_COLOR = '#CCCCCC'
const BORDER_COLOR = '#555555'
const BACKGROUND_COLOR = '#222738'

function renderShortcutRow(hint: KeyHint) {
  return (
    <box key={`${hint.key}-${hint.action}`} flexDirection="row" gap={2}>
      <box width={14} flexShrink={0}>
        <text fg={KEY_COLOR} wrapMode="none">
          <b>{hint.key}</b>
        </text>
      </box>
      <text fg={TEXT_COLOR} wrapMode="none">
        {hint.action}
      </text>
    </box>
  )
}

export function HelpDialog({ title, sections, width }: HelpDialogProps) {
  return (
    <box
      flexDirection="column"
      width={width}
      borderStyle="rounded"
      borderColor={BORDER_COLOR}
      backgroundColor={BACKGROUND_COLOR}
      paddingX={2}
      paddingY={1}
    >
      <box flexDirection="column" gap={1}>
        <text fg={TITLE_COLOR} wrapMode="none">
          <b>{title}</b>
        </text>

        {sections.map(section => (
          <box key={section.title} flexDirection="column" gap={0}>
            <text fg={SECTION_COLOR} wrapMode="none">
              <b>{section.title}</b>
            </text>
            {section.items.map(renderShortcutRow)}
          </box>
        ))}

        <text fg="#888888" wrapMode="none">
          Esc close help
        </text>
      </box>
    </box>
  )
}

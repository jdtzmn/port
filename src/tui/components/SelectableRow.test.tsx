import { test, expect } from 'vitest'
import { testRender } from '@opentui/react/test-utils'
import { RGBA } from '@opentui/core'
import { SelectableRow, SELECTED_ROW_BACKGROUND } from './SelectableRow.tsx'

test('SelectableRow applies a background only when selected', async () => {
  const { renderer, renderOnce, captureSpans } = await testRender(
    <>
      <SelectableRow selected={true}>
        <text>selected</text>
      </SelectableRow>
      <SelectableRow selected={false}>
        <text>idle</text>
      </SelectableRow>
    </>,
    { width: 20, height: 4 }
  )

  try {
    await renderOnce()
    const frame = captureSpans()
    const selectedLine = frame.lines.find(line =>
      line.spans.some(span => span.text.includes('selected'))
    )
    const idleLine = frame.lines.find(line => line.spans.some(span => span.text.includes('idle')))

    expect(selectedLine).toBeDefined()
    expect(idleLine).toBeDefined()

    const selectedSpan = selectedLine!.spans.find(span => span.text.includes('selected'))!
    const idleSpan = idleLine!.spans.find(span => span.text.includes('idle'))!

    expect(selectedSpan.bg.equals(RGBA.fromHex(SELECTED_ROW_BACKGROUND))).toBe(true)
    expect(idleSpan.bg.equals(RGBA.fromHex(SELECTED_ROW_BACKGROUND))).toBe(false)
  } finally {
    renderer.destroy()
  }
})

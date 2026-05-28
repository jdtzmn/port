import { afterEach, describe, expect, test } from 'bun:test'
import { RGBA } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import { HelpDialog } from '../components/HelpDialog.tsx'

const BLUE = RGBA.fromHex('#00AAFF')
const AMBER = RGBA.fromHex('#FFAA00')
const TEXT = RGBA.fromHex('#CCCCCC')

let currentRenderer: TestRenderer | null = null

afterEach(() => {
  if (currentRenderer) {
    currentRenderer.destroy()
    currentRenderer = null
  }
})

describe('HelpDialog', () => {
  test('renders a structured modal with current scheme colors', async () => {
    const { renderer, renderOnce, captureSpans, captureCharFrame } = await testRender(
      <HelpDialog
        title="Keyboard Shortcuts"
        width={72}
        sections={[
          {
            title: 'Shared',
            items: [
              { key: '?', action: 'toggle help' },
              { key: 'q', action: 'quit' },
            ],
          },
          {
            title: 'Worktrees',
            items: [{ key: 'Enter', action: 'inspect' }],
          },
        ]}
      />,
      { width: 96, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).toContain('Keyboard Shortcuts')
    expect(frame).toContain('Shared')
    expect(frame).toContain('Worktrees')
    expect(frame).toContain('Esc close help')

    const spans = captureSpans()
    const titleLine = spans.lines.find(line =>
      line.spans.some(span => span.text.includes('Keyboard Shortcuts'))
    )
    const sharedLine = spans.lines.find(line =>
      line.spans.some(span => span.text.includes('Shared'))
    )
    const keyLine = spans.lines.find(line => line.spans.some(span => span.text.includes('?')))
    const actionLine = spans.lines.find(line =>
      line.spans.some(span => span.text.includes('toggle help'))
    )

    expect(
      titleLine?.spans.some(
        span => span.text.includes('Keyboard Shortcuts') && span.fg.equals(BLUE)
      )
    ).toBe(true)
    expect(
      sharedLine?.spans.some(span => span.text.includes('Shared') && span.fg.equals(BLUE))
    ).toBe(true)
    expect(keyLine?.spans.some(span => span.text.includes('?') && span.fg.equals(AMBER))).toBe(true)
    expect(
      actionLine?.spans.some(span => span.text.includes('toggle help') && span.fg.equals(TEXT))
    ).toBe(true)
  })
})

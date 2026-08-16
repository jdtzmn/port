import { test, expect } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { RGBA } from '@opentui/core'
import {
  WorktreeRowStateIndicator,
  type WorktreeRowState,
} from './WorktreeRowStateIndicator.tsx'

test('WorktreeRowStateIndicator renders the expected glyph and color for each state', async () => {
  const cases: Array<[WorktreeRowState, string, string]> = [
    ['idle', '○', '#666666'],
    ['running', '●', '#FFD966'],
    ['success', '●', '#00FF00'],
    ['error', '●', '#FF4444'],
  ]

  for (const [state, glyph, color] of cases) {
    const { renderer, renderOnce, captureSpans } = await testRender(
      <WorktreeRowStateIndicator state={state} />,
      { width: 4, height: 1 }
    )

    try {
      await renderOnce()
      const span = captureSpans().lines[0]!.spans[0]!
      expect(span.text).toBe(glyph)
      expect(span.fg.equals(RGBA.fromHex(color))).toBe(true)
    } finally {
      renderer.destroy()
    }
  }
})

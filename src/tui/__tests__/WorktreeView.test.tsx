import { test, expect, afterEach, describe } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import { RGBA } from '@opentui/core'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { HostService, PortConfig } from '../../types.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { WorktreeView } from '../views/WorktreeView.tsx'
import { SELECTED_ROW_BACKGROUND } from '../components/SelectableRow.tsx'

const mockConfig: PortConfig = { domain: 'port' }

const mockWorktree: WorktreeStatus = {
  name: 'feature-auth',
  path: '/repo/.port/trees/feature-auth',
  services: [
    { name: 'web', ports: [3000], running: true },
    { name: 'api', ports: [8080], running: true },
    { name: 'db', ports: [5432], running: false },
  ],
  running: true,
}

const mockHostServices: HostService[] = [
  {
    repo: '/repo',
    branch: 'feature-auth',
    logicalPort: 5173,
    actualPort: 49821,
    pid: 12345,
    configFile: '/tmp/config.yml',
  },
]

const noop = () => {}
const noopAsync = async (): Promise<ActionResult> => ({ success: true, message: '' })
const mockActions = {
  downWorktree: noopAsync,
  killHostService: noopAsync,
}

function frameLine(frame: string, contains: string): string {
  return frame.split('\n').find(line => line.includes(contains)) ?? ''
}

function expectSelectedRowBackground(
  frame: { lines: Array<{ spans: Array<{ text: string; bg: RGBA }> }> },
  contains: string
) {
  const line = frame.lines.find(l => l.spans.some(span => span.text.includes(contains)))
  expect(line).toBeDefined()
  expect(line!.spans.some(span => span.bg.equals(RGBA.fromHex(SELECTED_ROW_BACKGROUND)))).toBe(true)
}

let currentRenderer: TestRenderer | null = null

afterEach(() => {
  if (currentRenderer) {
    currentRenderer.destroy()
    currentRenderer = null
  }
})

describe('WorktreeView', () => {
  test('renders service rows without pane chrome', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).not.toContain('feature-auth')
    expect(frame).not.toContain('http://feature-auth.port')
    expect(frame).not.toContain('Docker Services')
    expect(frame).toContain('web:3000')
    expect(frame).toContain('api:8080')
  })

  test('selected service rows use the shared background highlight', async () => {
    const { renderer, renderOnce, captureSpans } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    expectSelectedRowBackground(captureSpans(), 'web:3000')
  })

  test('hides the redundant title, url and docker services label', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).not.toContain('feature-auth')
    expect(frame).not.toContain('http://feature-auth.port')
    expect(frame).not.toContain('Docker Services')
  })

  test('renders docker services with ports', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).not.toContain('Docker Services')
    expect(frame).toContain('web')
    expect(frame).toContain(':3000')
    expect(frame).toContain('api')
    expect(frame).toContain(':8080')
    expect(frame).toContain('db')
    expect(frame).toContain(':5432')
  })

  test('renders host services', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).not.toContain('Host Services')
    expect(frame).toContain('port 5173')
    expect(frame).toContain('49821')
    expect(frame).toContain('PID 12345')
  })

  test('shows service status badges before the labels', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 80, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    const webLine = frame.split('\n').find(line => line.includes('web:3000')) ?? ''
    const dbLine = frame.split('\n').find(line => line.includes('db:5432')) ?? ''

    expect(webLine).toMatch(/^●/)
    expect(dbLine).toMatch(/^○/)
    expect(webLine).not.toMatch(/web:3000.*●/)
    expect(dbLine).not.toMatch(/db:5432.*○/)
  })

  test('Esc calls onBack', async () => {
    let backed = false
    const onBack = () => {
      backed = true
    }

    const { renderer, mockInput, renderOnce } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={onBack}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()

    mockInput.pressEscape()
    // Allow React to process the state update
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    expect(backed).toBe(true)
  })

  test('ignores navigation keys when keyboard is disabled', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
        keyboardEnabled={false}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const before = captureCharFrame()
    expect(frameLine(before, 'web:3000')).not.toContain('>')

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    const after = captureCharFrame()
    expect(frameLine(after, 'web:3000')).not.toContain('>')
    expect(frameLine(after, 'api:8080')).not.toContain('>')
  })

  test('does not render inline key hints', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 80, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).not.toContain('[Enter]')
    expect(frame).not.toContain('[d]')
    expect(frame).not.toContain('[Esc]')
    expect(frame).not.toContain('[r]')
    expect(frame).not.toContain('[q]')
  })

  test('shows no services message when empty', async () => {
    const emptyWorktree: WorktreeStatus = {
      name: 'empty',
      path: '/repo/.port/trees/empty',
      services: [],
      running: false,
    }

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={emptyWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).toContain('No services configured')
  })

  test('many services stay content-only', async () => {
    const manyServicesWorktree: WorktreeStatus = {
      name: 'big-app',
      path: '/repo/.port/trees/big-app',
      services: Array.from({ length: 20 }, (_, i) => ({
        name: `svc-${String(i + 1).padStart(2, '0')}`,
        ports: [3000 + i],
        running: i % 2 === 0,
      })),
      running: true,
    }

    // Short terminal: 10 lines can't fit header + 20 services + footer
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={manyServicesWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 10 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    const lines = frame.split('\n')

    expect(frame).not.toContain('big-app')
    expect(frame).not.toContain('http://big-app.port')

    // Not all 20 services should be visible (some must be clipped/scrolled)
    const serviceLines = lines.filter(l => l.includes('svc-'))
    expect(serviceLines.length).toBeLessThan(20)
    expect(serviceLines.length).toBeGreaterThan(0)
  })

  test('/ enters query mode without rendering a prompt', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).not.toContain('/ (type to filter)')
    expect(frame).not.toContain('[Type]')
    expect(frame).not.toContain('[Backspace]')
  })

  test('query mode accepts text and applies filter on Enter', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('a')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('p')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('i')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).not.toContain('/api')
    expect(frame).not.toContain('(1 match)')

    mockInput.pressEnter()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).not.toContain('/api (1 match)')
    expect(frame).not.toContain('[j/k]')
    expect(frameLine(frame, 'api:8080')).not.toContain('>')
  })

  test('filtered navigation j/k skips non-matching services', async () => {
    const filterWorktree: WorktreeStatus = {
      name: 'filter-test',
      path: '/repo/.port/trees/filter-test',
      services: [
        { name: 'alpha', ports: [3000], running: true },
        { name: 'db', ports: [5432], running: false },
        { name: 'api', ports: [8080], running: true },
      ],
      running: true,
    }

    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={filterWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('a')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressEnter()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frameLine(frame, 'alpha:3000')).not.toContain('>')

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frameLine(frame, 'api:8080')).not.toContain('>')
    expect(frameLine(frame, 'db:5432')).not.toContain('>')

    mockInput.pressKey('k')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frameLine(frame, 'alpha:3000')).not.toContain('>')

    mockInput.pressKey('k')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frameLine(frame, 'api:8080')).not.toContain('>')

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frameLine(frame, 'alpha:3000')).not.toContain('>')
  })

  test('Esc clears filtered mode and returns to normal navigation', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()
    mockInput.pressKey('a')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()
    mockInput.pressEnter()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressEscape()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).not.toContain('(match')

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frameLine(frame, 'db:5432')).not.toContain('>')
  })

  test('can filter by host-service port', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 100, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    for (const ch of ['5', '1', '7', '3']) {
      mockInput.pressKey(ch)
      await new Promise(resolve => setTimeout(resolve, 50))
      await renderOnce()
    }

    mockInput.pressEnter()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).not.toContain('/5173 (1 match)')
    expect(frame).toContain('port 5173')
  })

  test('Esc in query mode cancels back to normal mode', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()
    mockInput.pressKey('d')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).not.toContain('/d')

    mockInput.pressEscape()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).not.toContain('/d')
    expect(frame).not.toContain('[/]')
  })

  test('empty query Enter clears filter prompt', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={mockHostServices}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressEnter()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).not.toContain('(type to filter)')
    expect(frame).not.toContain('[/]')
  })
})

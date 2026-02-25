import { test, expect, afterEach, describe } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { HostService, PortConfig } from '../../types.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { WorktreeView } from '../views/WorktreeView.tsx'

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

let currentRenderer: TestRenderer | null = null

afterEach(() => {
  if (currentRenderer) {
    currentRenderer.destroy()
    currentRenderer = null
  }
})

describe('WorktreeView', () => {
  test('renders worktree name and URL', async () => {
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

    expect(frame).toContain('feature-auth')
    expect(frame).toContain('http://feature-auth.port')
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

    expect(frame).toContain('Docker Services')
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

    expect(frame).toContain('Host Services')
    expect(frame).toContain('port 5173')
    expect(frame).toContain('49821')
    expect(frame).toContain('PID 12345')
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

  test('shows key hints', async () => {
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

    expect(frame).toContain('[Enter]')
    expect(frame).toContain('[d]')
    expect(frame).toContain('[Esc]')
    expect(frame).toContain('[r]')
    expect(frame).toContain('[q]')
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

  test('many services do not overflow into header or key hints', async () => {
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

    // Header must remain visible
    expect(frame).toContain('big-app')
    expect(frame).toContain('http://big-app.port')

    // Not all 20 services should be visible (some must be clipped/scrolled)
    const serviceLines = lines.filter(l => l.includes('svc-'))
    expect(serviceLines.length).toBeLessThan(20)
    expect(serviceLines.length).toBeGreaterThan(0)
  })
})

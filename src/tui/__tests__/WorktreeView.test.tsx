import { test, expect, afterEach, describe } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { HostService, PortConfig } from '../../types.ts'
import type { EnqueueResult } from '../hooks/useActions.ts'
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
const noopAction = (): EnqueueResult => ({ accepted: true, jobId: 'job-1' })
const mockActions = {
  downWorktree: noopAction,
  killHostService: noopAction,
  isWorktreeBusy: () => false,
  latestJobByWorktree: new Map(),
  getOutputTail: () => [],
  isOutputVisible: () => true,
  toggleOutputVisible: noop,
  cancelWorktreeAction: () => false,
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
    expect(frame).toContain('[x]')
    expect(frame).not.toContain('[c]')
  })

  test('shows cancel hint only while current worktree action is running', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          isWorktreeBusy: () => true,
          latestJobByWorktree: new Map([
            [
              'feature-auth',
              {
                id: 'job-running',
                kind: 'down',
                worktreeName: 'feature-auth',
                worktreePath: '/repo/.port/trees/feature-auth',
                status: 'running',
                summary: 'down',
                logs: [],
              },
            ],
          ]),
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 100, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    expect(captureCharFrame()).toContain('[c]')
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

  test('d shows error status when action is rejected for busy worktree', async () => {
    const statusCalls: Array<{ text: string; type: 'success' | 'error' }> = []

    const { renderer, mockInput, renderOnce } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          downWorktree: () => ({
            accepted: false,
            reason: 'worktree_busy',
            message: 'Action already running for feature-auth',
          }),
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={(text: string, type: 'success' | 'error') => statusCalls.push({ text, type })}
      />,
      { width: 80, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('d')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    expect(statusCalls).toEqual([
      { text: 'Action already running for feature-auth', type: 'error' },
    ])
  })

  test('shows running and failed markers from latest job state', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          isWorktreeBusy: () => true,
          latestJobByWorktree: new Map([
            [
              'feature-auth',
              {
                id: 'job-running',
                kind: 'down',
                worktreeName: 'feature-auth',
                worktreePath: '/repo/.port/trees/feature-auth',
                status: 'running',
                summary: 'down',
                logs: [],
              },
            ],
          ]),
        }}
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
    expect(frame).toContain('down...')
  })

  test('c triggers cancellation for current worktree', async () => {
    const calls: string[] = []

    const { renderer, mockInput, renderOnce } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          cancelWorktreeAction: (name: string) => {
            calls.push(name)
            return true
          },
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('c')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    expect(calls).toEqual(['feature-auth'])
  })

  test('shows cancel status error when no running job is selected', async () => {
    const statusCalls: Array<{ text: string; type: 'success' | 'error' }> = []

    const { renderer, mockInput, renderOnce } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          cancelWorktreeAction: () => false,
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={(text: string, type: 'success' | 'error') => statusCalls.push({ text, type })}
      />,
      { width: 90, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('c')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    expect(statusCalls).toEqual([{ text: 'No running action selected to cancel', type: 'error' }])
  })

  test('renders two-line output tail', async () => {
    const tail = [
      { stream: 'stdout' as const, line: 'Stopping services...' },
      { stream: 'stderr' as const, line: 'warning: network busy' },
    ]

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          getOutputTail: () => tail,
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    expect(frame).toContain('Output (feature-auth)')
    expect(frame).toContain('[l] toggle')
    expect(frame).toContain('Stopping services...')
    expect(frame).toContain('warning: network busy')
  })

  test('l toggles output visibility for current worktree', async () => {
    const toggled: string[] = []

    const { renderer, mockInput, renderOnce } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          getOutputTail: () => [{ stream: 'stdout', line: 'line-1' }],
          toggleOutputVisible: (name: string) => toggled.push(name),
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('l')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    expect(toggled).toEqual(['feature-auth'])
  })

  test('hides output section when visibility is off for worktree', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          isOutputVisible: () => false,
          getOutputTail: () => [{ stream: 'stdout', line: 'line-1' }],
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 90, height: 22 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    expect(frame).not.toContain('Output (feature-auth)')
    expect(frame).not.toContain('line-1')
  })

  test('shows running and finished output titles with elapsed seconds', async () => {
    const runningJob = {
      id: 'job-running',
      kind: 'down' as const,
      worktreeName: 'feature-auth',
      worktreePath: '/repo/.port/trees/feature-auth',
      status: 'running' as const,
      summary: 'down',
      startedAt: 500,
      logs: [],
    }
    const finishedJob = {
      ...runningJob,
      id: 'job-finished',
      status: 'success' as const,
      endedAt: 3_000,
    }

    const {
      renderer: runningRenderer,
      renderOnce: renderRunning,
      captureCharFrame: captureRunning,
    } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          isWorktreeBusy: () => true,
          latestJobByWorktree: new Map([['feature-auth', runningJob]]),
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 110, height: 22 }
    )
    currentRenderer = runningRenderer
    await renderRunning()
    expect(captureRunning()).toContain('Output (feature-auth) - running for ')

    const {
      renderer: finishedRenderer,
      renderOnce: renderFinished,
      captureCharFrame: captureFinished,
    } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          latestJobByWorktree: new Map([['feature-auth', finishedJob]]),
          getOutputTail: () => [{ stream: 'stdout', line: 'done' }],
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 110, height: 22 }
    )
    currentRenderer = finishedRenderer
    await renderFinished()
    expect(captureFinished()).toContain('Output (feature-auth) - finished in 3s')
  })

  test('shows failure-specific output title wording', async () => {
    const failedJob = {
      id: 'job-failed',
      kind: 'down' as const,
      worktreeName: 'feature-auth',
      worktreePath: '/repo/.port/trees/feature-auth',
      status: 'error' as const,
      summary: 'down',
      startedAt: 1_000,
      endedAt: 5_900,
      logs: [],
    }

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <WorktreeView
        worktree={mockWorktree}
        hostServices={[]}
        config={mockConfig}
        repoRoot="/repo"
        onBack={noop}
        actions={{
          ...mockActions,
          latestJobByWorktree: new Map([['feature-auth', failedJob]]),
          getOutputTail: () => [{ stream: 'stderr', line: 'failed' }],
        }}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 110, height: 22 }
    )
    currentRenderer = renderer
    await renderOnce()

    expect(captureCharFrame()).toContain('Output (feature-auth) - failed in 5s')
  })
})

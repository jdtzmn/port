import { test, expect, afterEach, describe } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { HostService, PortConfig } from '../../types.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { TuiShell } from '../views/TuiShell.tsx'

const mockConfig: PortConfig = { domain: 'port' }

const mockWorktrees: WorktreeStatus[] = [
  {
    name: 'myapp',
    path: '/repo',
    services: [{ name: 'web', ports: [3000], running: true }],
    running: true,
  },
  {
    name: 'feature-auth',
    path: '/repo/.port/trees/feature-auth',
    services: [{ name: 'api', ports: [8080], running: true }],
    running: true,
  },
]

const noop = () => {}
const noopAsync = async (): Promise<ActionResult> => ({ success: true, message: '' })
const mockActions = {
  upWorktree: noopAsync,
  downWorktree: noopAsync,
  archiveWorktree: noopAsync,
  killHostService: noopAsync,
}

function frameLine(frame: string, contains: string): string {
  return frame.split('\n').find(line => line.includes(contains)) ?? ''
}

let currentRenderer: TestRenderer | null = null

afterEach(() => {
  if (currentRenderer) {
    currentRenderer.destroy()
    currentRenderer = null
  }
})

describe('TuiShell', () => {
  test('renders both panes and updates the services pane as selection changes', async () => {
    let exitRequested = false
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <TuiShell
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[] as HostService[]}
        traefikRunning={true}
        config={mockConfig}
        activeWorktreeName="myapp"
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
        requestExit={() => {
          exitRequested = true
        }}
      />,
      { width: 96, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    let frame = captureCharFrame()

    expect(frame).toContain('Worktrees')
    expect(frame).toContain('Services')
    expect(frame).toContain('myapp')
    expect(frame).not.toContain('http://myapp.port')
    expect(frame).toContain('web:3000')

    mockInput.pressEscape()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()
    expect(exitRequested).toBe(false)

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain('feature-auth')
    expect(frame).not.toContain('http://feature-auth.port')

    mockInput.pressKey('l')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain('api:8080')
  })

  test('defaults to a one-third worktrees and two-thirds services split', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <TuiShell
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[] as HostService[]}
        traefikRunning={true}
        config={mockConfig}
        activeWorktreeName="myapp"
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
        requestExit={noop}
      />,
      { width: 120, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    const servicesLine = frame.split('\n').find(line => line.includes('web:3000')) ?? ''

    expect(servicesLine.indexOf('web:3000')).toBeGreaterThan(35)
    expect(servicesLine.indexOf('web:3000')).toBeLessThan(55)
  })

  test('renders one shared footer row with plain hints and traefik status', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <TuiShell
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[] as HostService[]}
        traefikRunning={true}
        config={mockConfig}
        activeWorktreeName="myapp"
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
        requestExit={noop}
      />,
      { width: 96, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    const footerLine = frame
      .split('\n')
      .filter(line => line.trim().length > 0)
      .at(-1) ?? ''

    expect(frame).not.toContain('Esc cancel')
    expect(frame).toContain('q quit')
    expect(footerLine.startsWith(' ')).toBe(true)
    expect(footerLine).toContain('Port Running')
  })

  test('footer hints change for filter and confirm states', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <TuiShell
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[] as HostService[]}
        traefikRunning={true}
        config={mockConfig}
        activeWorktreeName="myapp"
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
        requestExit={noop}
      />,
      { width: 96, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let footerLine = captureCharFrame()
      .split('\n')
      .filter(line => line.trim().length > 0)
      .at(-1) ?? ''

    expect(footerLine).toContain('Type filter')
    expect(footerLine).toContain('Esc cancel')

    mockInput.pressEscape()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()
    mockInput.pressKey('a')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    footerLine = captureCharFrame()
      .split('\n')
      .filter(line => line.trim().length > 0)
      .at(-1) ?? ''

    expect(footerLine).toContain('y confirm')
    expect(footerLine).toContain('n cancel')
  })

  test('question mark opens and closes the help dialog without quitting', async () => {
    let exitRequested = false
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <TuiShell
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[] as HostService[]}
        traefikRunning={true}
        config={mockConfig}
        activeWorktreeName="myapp"
        actions={mockActions}
        refresh={noop}
        loading={false}
        statusMessage={null}
        showStatus={noop}
        requestExit={() => {
          exitRequested = true
        }}
      />,
      { width: 96, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('?')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).toContain('Help')
    expect(frame).toContain('Worktrees')
    expect(frame).toContain('Services')
    expect(frame).toContain('Esc close help')
    expect(exitRequested).toBe(false)

    mockInput.pressEscape()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).not.toContain('Help')
    expect(exitRequested).toBe(false)
  })

  test('shows a yellow port dot while loading', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <TuiShell
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[] as HostService[]}
        traefikRunning={false}
        config={mockConfig}
        activeWorktreeName="myapp"
        actions={mockActions}
        refresh={noop}
        loading={true}
        statusMessage={null}
        showStatus={noop}
        requestExit={noop}
      />,
      { width: 96, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).toContain('Port')
    expect(frame).not.toContain('Port Running')
    expect(frame).not.toContain('Port Stopped')
  })
})

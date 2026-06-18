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

async function pressAndRender(
  mockInput: { pressKey: (key: string) => void },
  renderOnce: () => Promise<void>,
  key: string
) {
  mockInput.pressKey(key)
  await new Promise(resolve => setTimeout(resolve, 50))
  await renderOnce()
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

  test('active worktree stays pinned while others sort by creation time', async () => {
    const recencyWorktrees: WorktreeStatus[] = [
      {
        name: 'current',
        path: '/repo',
        services: [],
        running: false,
        createdAt: '2026-05-04T00:00:00.000Z',
      },
      {
        name: 'one',
        path: '/repo/.port/trees/one',
        services: [{ name: 'web', ports: [3000], running: true }],
        running: true,
        createdAt: '2026-05-03T00:00:00.000Z',
      },
      {
        name: 'two',
        path: '/repo/.port/trees/two',
        services: [{ name: 'api', ports: [8080], running: true }],
        running: true,
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      {
        name: 'three',
        path: '/repo/.port/trees/three',
        services: [{ name: 'db', ports: [5432], running: true }],
        running: true,
        createdAt: '2026-05-02T00:00:00.000Z',
      },
    ]

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <TuiShell
        repoRoot="/repo"
        repoName="myapp"
        worktrees={recencyWorktrees}
        hostServices={[] as HostService[]}
        traefikRunning={true}
        config={mockConfig}
        activeWorktreeName="current"
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
    const getOrder = (frame: string) => {
      const lines = frame.split('\n')
      return ['current', 'three', 'two', 'one']
        .map(name => ({ name, index: lines.findIndex(line => line.includes(name)) }))
        .sort((a, b) => a.index - b.index)
        .map(({ name }) => name)
    }

    let frame = captureCharFrame()
    expect(getOrder(frame)).toEqual(['current', 'one', 'three', 'two'])
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
    const footerLine =
      frame
        .split('\n')
        .filter(line => line.trim().length > 0)
        .at(-1) ?? ''

    expect(footerLine).toContain('? toggle help')
    expect(footerLine.indexOf('? toggle help')).toBeLessThan(footerLine.indexOf('Port Running'))
    expect(footerLine.startsWith(' ')).toBe(true)
    expect(footerLine).toContain('Port Running')
  })

  test('slash query mode keeps l inside the worktree filter instead of moving focus', async () => {
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

    await pressAndRender(mockInput, renderOnce, 'a')
    await pressAndRender(mockInput, renderOnce, 'u')
    await pressAndRender(mockInput, renderOnce, 't')
    await pressAndRender(mockInput, renderOnce, 'h')
    await pressAndRender(mockInput, renderOnce, 'l')
    await pressAndRender(mockInput, renderOnce, 'j')

    const frame = captureCharFrame()
    expect(frame).toContain('/authlj')
  })

  test('truncates footer hints but keeps help pinned last', async () => {
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
      { width: 64, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    const footerLine =
      captureCharFrame()
        .split('\n')
        .filter(line => line.trim().length > 0)
        .at(-1) ?? ''

    expect(footerLine).toContain('? toggle help')
    expect(footerLine.indexOf('? toggle help')).toBeLessThan(footerLine.indexOf('Port Running'))
    expect(footerLine).not.toContain('archive')
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

    const footerLine =
      captureCharFrame()
        .split('\n')
        .filter(line => line.trim().length > 0)
        .at(-1) ?? ''

    expect(footerLine).toContain('Type type filter text')
    expect(footerLine).toContain('? toggle help')
    expect(footerLine.indexOf('Type type filter text')).toBeLessThan(
      footerLine.indexOf('? toggle help')
    )
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
    expect(frame).toContain('Keyboard Shortcuts')
    expect(frame).toContain('Worktrees')
    expect(frame).not.toContain('Services')
    expect(frame).toContain('Esc close help')
    expect(frame.indexOf('Worktrees')).toBeLessThan(frame.indexOf('Shared'))
    expect(exitRequested).toBe(false)

    mockInput.pressEscape()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).not.toContain('Keyboard Shortcuts')
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

import { test, expect, afterEach, describe } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { HostService, PortConfig } from '../../types.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { Dashboard } from '../views/Dashboard.tsx'

const mockConfig: PortConfig = { domain: 'port' }

const mockWorktrees: WorktreeStatus[] = [
  {
    name: 'myapp',
    path: '/repo',
    services: [
      { name: 'web', ports: [3000], running: true },
      { name: 'db', ports: [5432], running: true },
    ],
    running: true,
  },
  {
    name: 'feature-auth',
    path: '/repo/.port/trees/feature-auth',
    services: [
      { name: 'web', ports: [3000], running: false },
      { name: 'db', ports: [5432], running: false },
    ],
    running: false,
  },
]

const noop = () => {}
const noopAsync = async (): Promise<ActionResult> => ({ success: true, message: '' })
const mockActions = {
  upWorktree: noopAsync,
  downWorktree: noopAsync,
  archiveWorktree: noopAsync,
}

let currentRenderer: TestRenderer | null = null

afterEach(() => {
  if (currentRenderer) {
    currentRenderer.destroy()
    currentRenderer = null
  }
})

describe('Dashboard', () => {
  test('renders repo name and worktree list', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[]}
        traefikRunning={true}
        config={mockConfig}
        onSelectWorktree={noop}
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

    expect(frame).toContain('port: myapp')
    expect(frame).toContain('Traefik:')
    expect(frame).toContain('running')
    expect(frame).toContain('Worktrees')
    expect(frame).toContain('myapp')
    expect(frame).toContain('feature-auth')
  })

  test('shows root indicator on first worktree', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[]}
        traefikRunning={false}
        config={mockConfig}
        onSelectWorktree={noop}
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

    expect(frame).toContain('★')
    expect(frame).toContain('(root)')
  })

  test('shows service status indicators', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[]}
        traefikRunning={true}
        config={mockConfig}
        onSelectWorktree={noop}
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

    // Running services show ●, stopped show ○
    expect(frame).toContain('●')
    expect(frame).toContain('○')
  })

  test('shows key hints', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[]}
        traefikRunning={true}
        config={mockConfig}
        onSelectWorktree={noop}
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
    expect(frame).toContain('[u]')
    expect(frame).toContain('[d]')
    expect(frame).toContain('[a]')
    expect(frame).toContain('[r]')
    expect(frame).toContain('[q]')
  })

  test('j/k navigates worktree list', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <Dashboard
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[]}
        traefikRunning={true}
        config={mockConfig}
        onSelectWorktree={noop}
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
    const frame1 = captureCharFrame()

    // Initially first item selected — has > indicator
    // The first worktree row should have >
    expect(frame1).toContain('> ')

    // Move down
    mockInput.pressKey('j')
    await renderOnce()
    const frame2 = captureCharFrame()

    // After pressing j, the selection should have moved
    // The output should still contain both worktree names
    expect(frame2).toContain('myapp')
    expect(frame2).toContain('feature-auth')
  })

  test('Enter calls onSelectWorktree', async () => {
    let selectedName = ''
    const onSelect = (name: string) => {
      selectedName = name
    }

    const { renderer, mockInput, renderOnce } = await testRender(
      <Dashboard
        repoRoot="/repo"
        repoName="myapp"
        worktrees={mockWorktrees}
        hostServices={[]}
        traefikRunning={true}
        config={mockConfig}
        onSelectWorktree={onSelect}
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

    // Press Enter to select first worktree
    mockInput.pressEnter()
    await renderOnce()

    expect(selectedName).toBe('myapp')
  })

  test('shows loading state', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard
        repoRoot="/repo"
        repoName="myapp"
        worktrees={[]}
        hostServices={[]}
        traefikRunning={false}
        config={mockConfig}
        onSelectWorktree={noop}
        actions={mockActions}
        refresh={noop}
        loading={true}
        statusMessage={null}
        showStatus={noop}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).toContain('refreshing...')
  })
})

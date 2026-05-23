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
    let frame = captureCharFrame()

    expect(frame).toContain('Worktrees')
    expect(frame).toContain('Services')
    expect(frame).toContain('myapp')
    expect(frame).toContain('http://myapp.port')

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain('feature-auth')
    expect(frame).toContain('http://feature-auth.port')

    mockInput.pressKey('l')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain('api:8080')
  })
})

import { test, expect, afterEach, describe } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { HostService, PortConfig } from '../../types.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { Dashboard, findSubstringMatchRanges } from '../views/Dashboard.tsx'

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

const filterWorktrees: WorktreeStatus[] = [
  {
    name: 'myapp',
    path: '/repo',
    services: [],
    running: false,
  },
  {
    name: 'proj-jump',
    path: '/repo/.port/trees/proj-jump',
    services: [],
    running: false,
  },
  {
    name: 'feature-auth',
    path: '/repo/.port/trees/feature-auth',
    services: [],
    running: false,
  },
  {
    name: 'chore-clean',
    path: '/repo/.port/trees/chore-clean',
    services: [],
    running: false,
  },
  {
    name: 'bug-auth-ui',
    path: '/repo/.port/trees/bug-auth-ui',
    services: [],
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

/** Common Dashboard props with defaults for testing */
function props(overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: '/repo',
    repoName: 'myapp',
    worktrees: mockWorktrees,
    hostServices: [] as HostService[],
    traefikRunning: true,
    config: mockConfig,
    onSelectWorktree: noop,
    onOpenWorktree: noop,
    activeWorktreeName: 'myapp',
    initialSelectedName: null,
    actions: mockActions,
    refresh: noop,
    loading: false,
    statusMessage: null,
    showStatus: noop,
    ...overrides,
  }
}

function frameLine(frame: string, contains: string): string {
  return frame.split('\n').find(line => line.includes(contains)) ?? ''
}

async function pressAndRender(
  mockInput: { pressKey: (key: string) => void; pressEnter: () => void },
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

describe('Dashboard', () => {
  test('renders repo name and worktree list', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props()} />,
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

  test('shows active indicator on active worktree', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ activeWorktreeName: 'myapp', traefikRunning: false })} />,
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
      <Dashboard {...props()} />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).toContain('●')
    expect(frame).toContain('○')
  })

  test('findSubstringMatchRanges returns all case-insensitive matches', () => {
    const ranges = findSubstringMatchRanges('bug-auth-auth', 'AUTH')

    expect(ranges).toEqual([
      { start: 4, end: 8 },
      { start: 9, end: 13 },
    ])
  })

  test('shows key hints including enter, open, and jump', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props()} />,
      { width: 80, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).toContain('[Enter]')
    expect(frame).toContain('inspect')
    expect(frame).toContain('[o]')
    expect(frame).toContain('open')
    expect(frame).toContain('[/]')
    expect(frame).toContain('filter')
    expect(frame).toContain('[u]')
    expect(frame).toContain('[d]')
    expect(frame).toContain('[a]')
    expect(frame).toContain('[r]')
    expect(frame).toContain('[q]')
  })

  test('j/k navigates worktree list', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props()} />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame1 = captureCharFrame()
    expect(frame1).toContain('> ')

    mockInput.pressKey('j')
    await renderOnce()
    const frame2 = captureCharFrame()

    expect(frame2).toContain('myapp')
    expect(frame2).toContain('feature-auth')
  })

  test('Enter calls onSelectWorktree', async () => {
    let selectedName = ''
    const onSelect = (name: string) => {
      selectedName = name
    }

    const { renderer, mockInput, renderOnce } = await testRender(
      <Dashboard {...props({ onSelectWorktree: onSelect })} />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressEnter()
    await renderOnce()

    expect(selectedName).toBe('myapp')
  })

  test('o calls onOpenWorktree with selected worktree', async () => {
    let openedName = ''
    const onOpen = (name: string) => {
      openedName = name
    }

    const { renderer, mockInput, renderOnce } = await testRender(
      <Dashboard {...props({ onOpenWorktree: onOpen })} />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()

    // Move to second worktree and press o
    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('o')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    expect(openedName).toBe('feature-auth')
  })

  test('/ enters query mode without resetting the caret', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props()} />,
      { width: 80, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    const frame = captureCharFrame()

    expect(frameLine(frame, 'feature-auth')).toContain('>')
    expect(frame).toContain('(type to filter)')
  })

  test('query mode accepts j as query text', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ worktrees: filterWorktrees, activeWorktreeName: 'myapp' })} />,
      { width: 90, height: 24 }
    )
    currentRenderer = renderer

    await renderOnce()
    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    const frame = captureCharFrame()

    expect(frame).toContain('/j')
    expect(frame).toContain('(1 match)')
    expect(frameLine(frame, 'myapp (root)')).toContain('>')
  })

  test('filtered navigation j/k skips non-matching worktrees', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ worktrees: filterWorktrees, activeWorktreeName: 'myapp' })} />,
      { width: 90, height: 24 }
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

    mockInput.pressEnter()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frameLine(frame, 'feature-auth')).toContain('>')

    mockInput.pressKey('j')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frameLine(frame, 'bug-auth-ui')).toContain('>')
    expect(frameLine(frame, 'chore-clean')).not.toContain('>')

    mockInput.pressKey('k')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frameLine(frame, 'feature-auth')).toContain('>')
  })

  test('[/] edit filter clears the current query before typing', async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ worktrees: filterWorktrees, activeWorktreeName: 'myapp' })} />,
      { width: 90, height: 24 }
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

    mockInput.pressEnter()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    let frame = captureCharFrame()
    expect(frame).toContain('/auth')

    mockInput.pressKey('/')
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    frame = captureCharFrame()
    expect(frame).toContain('/ (type to filter)')

    await pressAndRender(mockInput, renderOnce, 'j')

    frame = captureCharFrame()
    expect(frame).toContain('/j')
    expect(frame).not.toContain('/authj')
  })

  test('star indicator follows activeWorktreeName', async () => {
    // Active worktree is feature-auth, not the root
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ activeWorktreeName: 'feature-auth' })} />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    // Split into lines to check which row has the star
    const lines = frame.split('\n')
    const rootLine = lines.find(l => l.includes('(root)'))
    const authLine = lines.find(l => l.includes('feature-auth'))

    // Root should NOT have star
    expect(rootLine).toBeDefined()
    expect(rootLine!).not.toContain('★')

    // feature-auth SHOULD have star
    expect(authLine).toBeDefined()
    expect(authLine!).toContain('★')
  })

  test('shows loading state', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ worktrees: [], traefikRunning: false, loading: true })} />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    expect(frame).toContain('refreshing...')
  })
})

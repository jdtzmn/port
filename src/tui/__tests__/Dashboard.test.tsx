import { test, expect, afterEach, describe } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import type { TestRenderer } from '@opentui/core/testing'
import { useEffect, useState } from 'react'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { HostService, PortConfig } from '../../types.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { Dashboard, findSubstringMatchRanges, buildServicesText } from '../views/Dashboard.tsx'

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

  test('initialSelectedName places caret on current worktree', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard
        {...props({
          activeWorktreeName: 'feature-auth',
          initialSelectedName: 'feature-auth',
        })}
      />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    const authLine = frame.split('\n').find(line => line.includes('feature-auth'))

    expect(authLine).toBeDefined()
    expect(authLine!).toContain('>')
    expect(authLine!).toContain('★')
  })

  test('applies initialSelectedName after async worktree load', async () => {
    function AsyncDashboard() {
      const [worktrees, setWorktrees] = useState<WorktreeStatus[]>([])

      useEffect(() => {
        setWorktrees(mockWorktrees)
      }, [])

      return (
        <Dashboard
          {...props({
            worktrees,
            activeWorktreeName: 'feature-auth',
            initialSelectedName: 'feature-auth',
            loading: worktrees.length === 0,
          })}
        />
      )
    }

    const { renderer, renderOnce, captureCharFrame } = await testRender(<AsyncDashboard />, {
      width: 60,
      height: 20,
    })
    currentRenderer = renderer

    await renderOnce()
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderOnce()

    const frame = captureCharFrame()
    const authLine = frame.split('\n').find(line => line.includes('feature-auth'))

    expect(authLine).toBeDefined()
    expect(authLine!).toContain('>')
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

  test('displays running services before stopped services', async () => {
    const mixedWorktrees: WorktreeStatus[] = [
      {
        name: 'myapp',
        path: '/repo',
        services: [
          { name: 'db', ports: [5432], running: false },
          { name: 'web', ports: [3000], running: true },
          { name: 'redis', ports: [6379], running: false },
          { name: 'api', ports: [4000], running: true },
        ],
        running: true,
      },
    ]

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ worktrees: mixedWorktrees, activeWorktreeName: '' })} />,
      { width: 120, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    const appLine = frame.split('\n').find(l => l.includes('(root)'))!

    // Running services (web, api) should appear before stopped (db, redis)
    const webPos = appLine.indexOf('web')
    const apiPos = appLine.indexOf('api')
    const dbPos = appLine.indexOf('db')
    const redisPos = appLine.indexOf('redis')

    expect(webPos).toBeGreaterThan(-1)
    expect(apiPos).toBeGreaterThan(-1)
    expect(dbPos).toBeGreaterThan(-1)
    expect(redisPos).toBeGreaterThan(-1)
    expect(webPos).toBeLessThan(dbPos)
    expect(apiPos).toBeLessThan(dbPos)
    expect(webPos).toBeLessThan(redisPos)
    expect(apiPos).toBeLessThan(redisPos)
  })

  test('shows total count for worktrees with services', async () => {
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ activeWorktreeName: '' })} />,
      { width: 80, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    // mockWorktrees first entry has 2 services (web, db)
    expect(frame).toContain('2 total')
  })

  test('services text truncates at narrow widths and shows total count', async () => {
    const manyServicesWorktrees: WorktreeStatus[] = [
      {
        name: 'myapp',
        path: '/repo',
        services: [
          { name: 'web', ports: [3000], running: true },
          { name: 'api', ports: [4000], running: true },
          { name: 'db', ports: [5432], running: true },
          { name: 'redis', ports: [6379], running: true },
          { name: 'worker', ports: [8000], running: true },
          { name: 'scheduler', ports: [9000], running: true },
        ],
        running: true,
      },
    ]

    // 60 cols: enough for name + some services + total, but not all services
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ worktrees: manyServicesWorktrees, activeWorktreeName: '' })} />,
      { width: 60, height: 20 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()

    // The total count suffix should always be visible
    expect(frame).toContain('6 total')
  })

  test('rows stay single-line with long names, many services, and narrow widths', async () => {
    const stressWorktrees: WorktreeStatus[] = [
      {
        name: 'myapp',
        path: '/repo',
        services: [
          { name: 'web', ports: [3000], running: true },
          { name: 'api', ports: [4000], running: true },
          { name: 'db', ports: [5432], running: false },
          { name: 'redis', ports: [6379], running: false },
          { name: 'worker', ports: [8000], running: true },
          { name: 'scheduler', ports: [9000], running: false },
          { name: 'nginx', ports: [80], running: true },
          { name: 'mailhog', ports: [1025], running: false },
          { name: 'minio', ports: [9001], running: true },
          { name: 'elasticsearch', ports: [9200], running: false },
        ],
        running: true,
      },
      {
        name: 'jacob-fix-floating-chat-bar-on-full-page-routes',
        path: '/repo/.port/trees/jacob-fix-floating-chat-bar-on-full-page-routes',
        services: [
          { name: 'web', ports: [3000], running: true },
          { name: 'api', ports: [4000], running: true },
          { name: 'db', ports: [5432], running: false },
          { name: 'redis', ports: [6379], running: true },
          { name: 'worker', ports: [8000], running: false },
          { name: 'scheduler', ports: [9000], running: false },
          { name: 'nginx', ports: [80], running: true },
        ],
        running: true,
      },
      {
        name: 'feature-implement-oauth2-pkce-flow-with-refresh-token-rotation',
        path: '/repo/.port/trees/feature-implement-oauth2-pkce-flow-with-refresh-token-rotation',
        services: [
          { name: 'web', ports: [3000], running: false },
          { name: 'api', ports: [4000], running: false },
        ],
        running: false,
      },
      {
        name: 'short',
        path: '/repo/.port/trees/short',
        services: [{ name: 'web', ports: [3000], running: true }],
        running: true,
      },
    ]

    for (const width of [60, 80, 120]) {
      const { renderer, renderOnce, captureCharFrame } = await testRender(
        <Dashboard {...props({ worktrees: stressWorktrees, activeWorktreeName: 'myapp' })} />,
        { width, height: 20 }
      )
      currentRenderer = renderer

      await renderOnce()
      const frame = captureCharFrame()
      const lines = frame.split('\n')

      // Each worktree should render on exactly one line
      const worktreeLines = lines.filter(
        l =>
          l.includes('myapp') ||
          l.includes('jacob-fix') ||
          l.includes('feature-impl') ||
          l.includes('short')
      )
      // At minimum, 4 worktree names should each appear on their own line
      expect(worktreeLines.length).toBeGreaterThanOrEqual(4)

      // "N total" suffix should always be visible for every worktree with services
      expect(frame).toContain('10 total')
      expect(frame).toContain('7 total')
      expect(frame).toContain('2 total')
      expect(frame).toContain('1 total')

      // No worktree name should spill onto a second line (check that name fragments
      // like "(root)" don't appear on a line without "myapp")
      const rootLines = lines.filter(l => l.includes('(root)'))
      for (const rootLine of rootLines) {
        expect(rootLine).toContain('myapp')
      }

      renderer.destroy()
      currentRenderer = null
    }
  })

  test('many worktrees do not overflow into header area', async () => {
    const manyWorktrees: WorktreeStatus[] = Array.from({ length: 20 }, (_, i) => ({
      name: i === 0 ? 'myapp' : `branch-${String(i).padStart(2, '0')}`,
      path: i === 0 ? '/repo' : `/repo/.port/trees/branch-${String(i).padStart(2, '0')}`,
      services: [{ name: 'web', ports: [3000], running: i % 2 === 0 }],
      running: i % 2 === 0,
    }))

    // Short terminal: 12 lines can't fit header + 20 worktrees + footer
    const { renderer, renderOnce, captureCharFrame } = await testRender(
      <Dashboard {...props({ worktrees: manyWorktrees, activeWorktreeName: 'myapp' })} />,
      { width: 80, height: 12 }
    )
    currentRenderer = renderer

    await renderOnce()
    const frame = captureCharFrame()
    const lines = frame.split('\n')

    // Header elements must remain visible and not be overwritten by worktree rows
    expect(frame).toContain('port: myapp')
    expect(frame).toContain('Traefik:')
    expect(frame).toContain('Worktrees')

    // The "Worktrees" label should appear BEFORE any worktree row
    const worktreesLabelLine = lines.findIndex(l => l.includes('Worktrees'))
    const firstRowLine = lines.findIndex(l => l.includes('> '))
    expect(worktreesLabelLine).toBeGreaterThan(-1)
    expect(firstRowLine).toBeGreaterThan(worktreesLabelLine)

    // Not all 20 worktrees should be visible (some must be clipped)
    const visibleBranches = lines.filter(l => l.includes('branch-')).length
    expect(visibleBranches).toBeLessThan(20)
  })
})

describe('buildServicesText', () => {
  test('joins services with status indicators', () => {
    const services = [
      { name: 'web', running: true },
      { name: 'db', running: false },
    ]
    expect(buildServicesText(services)).toBe('web ● db ○')
  })

  test('returns empty string for no services', () => {
    expect(buildServicesText([])).toBe('')
  })

  test('preserves input order', () => {
    const services = [
      { name: 'alpha', running: true },
      { name: 'beta', running: false },
      { name: 'gamma', running: true },
    ]
    expect(buildServicesText(services)).toBe('alpha ● beta ○ gamma ●')
  })
})

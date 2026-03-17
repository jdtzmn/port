import { useEffect, useRef, useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionJob, EnqueueResult, OutputTailLine } from '../hooks/useActions.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { KeyHints } from '../components/KeyHints.tsx'

interface Actions {
  downWorktree: (worktreePath: string, worktreeName: string) => EnqueueResult
  killHostService: (service: HostService) => EnqueueResult
  isWorktreeBusy: (worktreeName: string) => boolean
  latestJobByWorktree: Map<string, ActionJob>
  getOutputTail: (worktreeName: string) => OutputTailLine[]
  cancelWorktreeAction: (worktreeName: string) => boolean
}

interface WorktreeViewProps {
  worktree: WorktreeStatus | null
  hostServices: HostService[]
  config: PortConfig
  repoRoot: string
  onBack: () => void
  actions: Actions
  refresh: () => void
  loading: boolean
  statusMessage: { text: string; type: 'success' | 'error' } | null
  showStatus: (text: string, type: 'success' | 'error') => void
}

interface ServiceItem {
  type: 'docker' | 'host'
  name: string
  port: number
  running: boolean
  url: string
  pid?: number
  actualPort?: number
  /** Reference to original host service for kill action */
  hostService?: HostService
}

function buildServiceItems(
  worktree: WorktreeStatus | null,
  hostServices: HostService[],
  config: PortConfig,
  worktreeName: string
): ServiceItem[] {
  const items: ServiceItem[] = []
  const baseUrl = `http://${worktreeName}.${config.domain}`

  if (worktree) {
    for (const service of worktree.services) {
      for (const port of service.ports) {
        items.push({
          type: 'docker',
          name: service.name,
          port,
          running: service.running,
          url: `${baseUrl}:${port}`,
        })
      }
      if (service.ports.length === 0) {
        items.push({
          type: 'docker',
          name: service.name,
          port: 0,
          running: service.running,
          url: '',
        })
      }
    }
  }

  for (const hs of hostServices) {
    items.push({
      type: 'host',
      name: `port ${hs.logicalPort}`,
      port: hs.logicalPort,
      running: true,
      url: `${baseUrl}:${hs.logicalPort}`,
      pid: hs.pid,
      actualPort: hs.actualPort,
      hostService: hs,
    })
  }

  return items
}

function formatElapsedSeconds(job: ActionJob): string | null {
  if (typeof job.startedAt !== 'number' || typeof job.endedAt !== 'number') {
    return null
  }
  const seconds = Math.max(1, Math.round((job.endedAt - job.startedAt) / 1000))
  return `${seconds}s`
}

function formatRunningSeconds(job: ActionJob): string | null {
  if (typeof job.startedAt !== 'number') {
    return null
  }
  const seconds = Math.max(1, Math.round((Date.now() - job.startedAt) / 1000))
  return `${seconds}s`
}

function formatOutputTitle(
  worktreeName: string,
  latestJob: ActionJob | undefined,
  running: boolean
): string {
  const base = `Output (${worktreeName})`
  if (!latestJob) {
    return running ? `${base} - running` : base
  }

  if (running || latestJob.status === 'running') {
    const elapsed = formatRunningSeconds(latestJob)
    return elapsed ? `${base} - running for ${elapsed}` : `${base} - running`
  }

  const elapsed = formatElapsedSeconds(latestJob)
  if (!elapsed) {
    return base
  }

  if (latestJob.status === 'success') {
    return `${base} - finished in ${elapsed}`
  }
  if (latestJob.status === 'error') {
    return `${base} - failed in ${elapsed}`
  }
  if (latestJob.status === 'cancelled') {
    return `${base} - cancelled in ${elapsed}`
  }

  return base
}

export function WorktreeView({
  worktree,
  hostServices,
  config,
  onBack,
  actions,
  loading,
  statusMessage,
  showStatus,
}: WorktreeViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  // Keep selected service visible inside the scrollbox.
  // Estimate the content line for the selected item accounting for section
  // headers (1 line each) and the host section spacer (1 line).
  useEffect(() => {
    const sb = scrollRef.current
    if (!sb) return
    const vpHeight = sb.viewport.height
    if (vpHeight <= 0) return

    const svcs = buildServiceItems(worktree, hostServices, config, worktree?.name ?? 'unknown')
    const hasDocker = svcs.some(s => s.type === 'docker')
    const hasHost = svcs.some(s => s.type === 'host')
    const dockerCount = svcs.filter(s => s.type === 'docker').length

    // Docker header is outside the scrollbox, so line 0 is the first docker row.
    let line = 0
    const selected = svcs[selectedIndex]
    if (selected?.type === 'docker') {
      let seen = 0
      for (let i = 0; i < svcs.length; i++) {
        if (svcs[i]!.type === 'docker') {
          if (i === selectedIndex) break
          seen++
        }
      }
      line += seen
    } else if (selected?.type === 'host') {
      line += dockerCount // all docker rows
      if (hasDocker && hasHost) {
        line += 1 // spacer between sections
      }
      line += 1 // "Host Services" header
      let seen = 0
      for (let i = 0; i < svcs.length; i++) {
        if (svcs[i]!.type === 'host') {
          if (i === selectedIndex) break
          seen++
        }
      }
      line += seen
    }

    if (line < sb.scrollTop) {
      sb.scrollTop = line
    } else if (line >= sb.scrollTop + vpHeight) {
      sb.scrollTop = line - vpHeight + 1
    }
  }, [selectedIndex, worktree, hostServices, config])

  const worktreeName = worktree?.name ?? 'unknown'
  const baseUrl = `http://${worktreeName}.${config.domain}`
  const services = buildServiceItems(worktree, hostServices, config, worktreeName)
  const latestJob = actions.latestJobByWorktree.get(worktreeName)
  const runningAction = actions.isWorktreeBusy(worktreeName)

  useKeyboard(event => {
    if (event.ctrl || event.meta) return

    if (event.name === 'c') {
      if (!actions.cancelWorktreeAction(worktreeName)) {
        showStatus('No running action selected to cancel', 'error')
      }
      return
    }

    const maxIndex = Math.max(services.length - 1, 0)

    switch (event.name) {
      case 'j':
      case 'down':
        setSelectedIndex(i => Math.min(i + 1, maxIndex))
        break
      case 'k':
      case 'up':
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'escape':
        onBack()
        break
      case 'return': {
        const selected = services[selectedIndex]
        if (selected?.url) {
          const cmd =
            process.platform === 'darwin'
              ? 'open'
              : process.platform === 'win32'
                ? 'start'
                : 'xdg-open'
          import('child_process').then(({ exec }) => {
            exec(`${cmd} ${selected.url}`)
          })
        }
        break
      }
      case 'd':
        if (worktree) {
          const result = actions.downWorktree(worktree.path, worktree.name)
          if (!result.accepted) {
            showStatus(result.message, 'error')
          }
        }
        break
      case 'x': {
        const selected = services[selectedIndex]
        if (selected?.type === 'host' && selected.hostService) {
          const result = actions.killHostService(selected.hostService)
          if (!result.accepted) {
            showStatus(result.message, 'error')
          }
        }
        break
      }
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text>
          <b>{worktreeName}</b>
        </text>
        {loading && <text fg="#888888"> refreshing...</text>}
        {runningAction && latestJob && <text fg="#FFFF00"> {latestJob.kind}...</text>}
        {!runningAction && latestJob?.status === 'error' && (
          <text fg="#FF4444"> {latestJob.kind} failed</text>
        )}
      </box>

      {/* URL */}
      <text fg="#00AAFF" flexShrink={0}>
        {baseUrl}
      </text>

      <box height={1} flexShrink={0} />

      {(runningAction || actions.getOutputTail(worktreeName).length > 0) && (
        <box flexDirection="column" flexShrink={0}>
          <text fg="#888888">
            <b>{formatOutputTitle(worktreeName, latestJob, runningAction)}</b>
          </text>
          {actions.getOutputTail(worktreeName).map((entry, index) => (
            <text
              key={`${worktreeName}-tail-${index}`}
              fg={entry.stream === 'stderr' ? '#FF8888' : '#888888'}
            >
              {entry.line}
            </text>
          ))}
          {actions.getOutputTail(worktreeName).length === 0 && (
            <text fg="#666666">No output yet...</text>
          )}
        </box>
      )}

      <box height={1} flexShrink={0} />

      {/* Docker services header (always visible) */}
      {services.some(s => s.type === 'docker') && (
        <text fg="#888888" flexShrink={0}>
          <b>Docker Services</b>
        </text>
      )}

      {/* Scrollable services list */}
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: 'column', width: '100%' }}
      >
        {/* Docker services */}
        {services.some(s => s.type === 'docker') && (
          <>
            {services
              .filter(s => s.type === 'docker')
              .map((service, i) => {
                const globalIndex = services.findIndex(s => s === service)
                const isSelected = globalIndex === selectedIndex

                return (
                  <box key={`${service.name}-${service.port}-${i}`} flexDirection="row" gap={1}>
                    <text>{isSelected ? '>' : ' '}</text>
                    <text>{isSelected ? <b>{service.name}</b> : service.name}</text>
                    {service.port > 0 && <text fg="#888888">:{service.port}</text>}
                    <StatusIndicator running={service.running} />
                    <text fg="#888888">{service.running ? 'running' : 'stopped'}</text>
                  </box>
                )
              })}
          </>
        )}

        {/* Host services section */}
        {services.some(s => s.type === 'host') && (
          <>
            <box height={1} />
            <text fg="#888888">
              <b>Host Services</b>
            </text>

            {services
              .filter(s => s.type === 'host')
              .map(service => {
                const globalIndex = services.findIndex(s => s === service)
                const isSelected = globalIndex === selectedIndex

                return (
                  <box key={`host-${service.port}`} flexDirection="row" gap={1}>
                    <text>{isSelected ? '>' : ' '}</text>
                    <text>{isSelected ? <b>{service.name}</b> : service.name}</text>
                    <text fg="#888888">
                      :{service.port} → :{service.actualPort}
                    </text>
                    <text fg="#888888">PID {service.pid}</text>
                    <StatusIndicator running={service.running} />
                  </box>
                )
              })}
          </>
        )}

        {services.length === 0 && !loading && <text fg="#888888">No services configured</text>}
      </scrollbox>

      <box height={1} flexShrink={0} />

      {/* Status message */}
      {statusMessage && (
        <text fg={statusMessage.type === 'success' ? '#00FF00' : '#FF4444'} flexShrink={0}>
          {statusMessage.text}
        </text>
      )}

      {/* Key hints */}
      <KeyHints
        hints={[
          { key: 'Enter', action: 'open in browser' },
          { key: 'd', action: 'down' },
          { key: 'x', action: 'kill host svc' },
          ...(runningAction ? [{ key: 'c', action: 'cancel running' }] : []),
          { key: 'Esc', action: 'back' },
          { key: 'r', action: 'refresh' },
          { key: 'q', action: 'quit' },
        ]}
      />
    </box>
  )
}

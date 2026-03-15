import { useEffect, useRef, useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { KeyHints } from '../components/KeyHints.tsx'
import { useFilterNavigation } from '../hooks/useFilterNavigation.ts'
import { findSubstringMatchRanges, type MatchRange } from '../lib/filtering.ts'

interface Actions {
  downWorktree: (worktreePath: string, worktreeName: string) => Promise<ActionResult>
  killHostService: (service: HostService) => Promise<ActionResult>
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

function serviceSearchText(service: ServiceItem): string {
  if (service.type === 'docker') {
    return `${service.name} docker ${service.port > 0 ? service.port : ''}`.trim()
  }

  return `${service.name} host ${service.port} ${service.actualPort ?? ''} ${service.pid ?? ''}`.trim()
}

function serviceLabelText(service: ServiceItem): string {
  if (service.type === 'docker') {
    return `${service.name}${service.port > 0 ? `:${service.port}` : ''}`
  }

  return `${service.name} :${service.port} -> :${service.actualPort} PID ${service.pid}`
}

function buildHighlightedSegments(text: string, ranges: MatchRange[]): React.ReactNode[] {
  const segments: React.ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push(text.slice(cursor, range.start))
    }
    segments.push(
      <span key={range.start} fg="#00AAFF">
        {text.slice(range.start, range.end)}
      </span>
    )
    cursor = range.end
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor))
  }
  return segments
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
  const [busy, setBusy] = useState(false)
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
  const {
    mode,
    highlightQuery,
    highlightMatches,
    handleKey: handleFilterKey,
  } = useFilterNavigation({
    items: services,
    setSelectedIndex,
    getSearchText: serviceSearchText,
  })

  useKeyboard(event => {
    if (event.ctrl || event.meta || busy) return
    const keySequence = (event as { sequence?: string }).sequence

    if (handleFilterKey({ eventName: event.name, keySequence })) {
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
          setBusy(true)
          actions
            .downWorktree(worktree.path, worktree.name)
            .then(result => {
              showStatus(result.message, result.success ? 'success' : 'error')
            })
            .finally(() => setBusy(false))
        }
        break
      case 'x': {
        const selected = services[selectedIndex]
        if (selected?.type === 'host' && selected.hostService) {
          setBusy(true)
          actions
            .killHostService(selected.hostService)
            .then(result => {
              showStatus(result.message, result.success ? 'success' : 'error')
            })
            .finally(() => setBusy(false))
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
        {busy && <text fg="#FFFF00"> working...</text>}
      </box>

      {/* URL */}
      <text fg="#00AAFF" flexShrink={0}>
        {baseUrl}
      </text>

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
                const labelText = serviceLabelText(service)
                const matchRanges = highlightQuery
                  ? findSubstringMatchRanges(labelText, highlightQuery)
                  : []

                return (
                  <box key={`${service.name}-${service.port}-${i}`} flexDirection="row" gap={1}>
                    <text>{isSelected ? '>' : ' '}</text>
                    <text>
                      {isSelected ? (
                        <b>
                          {matchRanges.length > 0
                            ? buildHighlightedSegments(labelText, matchRanges)
                            : labelText}
                        </b>
                      ) : matchRanges.length > 0 ? (
                        buildHighlightedSegments(labelText, matchRanges)
                      ) : (
                        labelText
                      )}
                    </text>
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
                const labelText = serviceLabelText(service)
                const matchRanges = highlightQuery
                  ? findSubstringMatchRanges(labelText, highlightQuery)
                  : []

                return (
                  <box key={`host-${service.port}`} flexDirection="row" gap={1}>
                    <text>{isSelected ? '>' : ' '}</text>
                    <text>
                      {isSelected ? (
                        <b>
                          {matchRanges.length > 0
                            ? buildHighlightedSegments(labelText, matchRanges)
                            : labelText}
                        </b>
                      ) : matchRanges.length > 0 ? (
                        buildHighlightedSegments(labelText, matchRanges)
                      ) : (
                        labelText
                      )}
                    </text>
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

      {mode !== 'normal' && (
        <text
          fg={
            mode === 'query'
              ? highlightQuery.length === 0
                ? '#888888'
                : highlightMatches.length > 0
                  ? '#00AAFF'
                  : '#FFAA00'
              : '#00AAFF'
          }
        >
          /{highlightQuery}{' '}
          {highlightQuery.length === 0
            ? '(type to filter)'
            : `(${highlightMatches.length} match${highlightMatches.length === 1 ? '' : 'es'})`}
        </text>
      )}

      {/* Key hints */}
      <KeyHints
        hints={
          mode === 'query'
            ? [
                { key: 'Type', action: 'filter' },
                { key: 'Backspace', action: 'delete' },
                { key: 'Enter', action: 'apply' },
                { key: 'Esc', action: 'cancel' },
              ]
            : mode === 'filtered-nav'
              ? [
                  { key: 'j/k', action: 'next/prev match' },
                  { key: '/', action: 'edit filter' },
                  { key: 'Esc', action: 'clear filter' },
                  { key: 'Enter', action: 'open in browser' },
                ]
              : [
                  { key: 'Enter', action: 'open in browser' },
                  { key: '/', action: 'filter' },
                  { key: 'd', action: 'down' },
                  { key: 'x', action: 'kill host svc' },
                  { key: 'Esc', action: 'back' },
                  { key: 'r', action: 'refresh' },
                  { key: 'q', action: 'quit' },
                ]
        }
      />
    </box>
  )
}

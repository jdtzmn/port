import { StyledText, bold, fg, stringToStyledText, type TextChunk } from '@opentui/core'
import { useEffect, useRef, useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import type { ActionResult } from '../hooks/useActions.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { SelectableRow } from '../components/SelectableRow.tsx'
import { useFilterNavigation } from '../hooks/useFilterNavigation.ts'
import { findSubstringMatchRanges, type MatchRange } from '../lib/filtering.ts'
import { isQuestionMarkKey, useTuiInteraction } from '../lib/interaction.tsx'

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
  keyboardEnabled?: boolean
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

function buildHighlightedContent(text: string, ranges: MatchRange[], isBold: boolean): StyledText {
  const chunks: TextChunk[] = []
  let cursor = 0

  const pushChunk = (chunk: TextChunk) => {
    chunks.push(isBold ? bold(chunk) : chunk)
  }

  for (const range of ranges) {
    if (range.start > cursor) {
      for (const chunk of stringToStyledText(text.slice(cursor, range.start)).chunks) {
        pushChunk(chunk)
      }
    }
    pushChunk(
      isBold
        ? bold(fg('#00AAFF')(text.slice(range.start, range.end)))
        : fg('#00AAFF')(text.slice(range.start, range.end))
    )
    cursor = range.end
  }
  if (cursor < text.length) {
    for (const chunk of stringToStyledText(text.slice(cursor)).chunks) {
      pushChunk(chunk)
    }
  }
  return new StyledText(chunks)
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
  keyboardEnabled = true,
}: WorktreeViewProps) {
  const { dispatch } = useTuiInteraction()
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
  const services = buildServiceItems(worktree, hostServices, config, worktreeName)
  const {
    mode,
    highlightQuery,
    handleKey: handleFilterKey,
  } = useFilterNavigation({
    items: services,
    setSelectedIndex,
    getSearchText: serviceSearchText,
  })

  useEffect(() => {
    dispatch({ type: 'set-pane-mode', pane: 'services', mode })
  }, [dispatch, mode])

  useKeyboard(event => {
    if (!keyboardEnabled || event.ctrl || event.meta || busy) return
    const keySequence = (event as { sequence?: string }).sequence
    if (isQuestionMarkKey(event.name, keySequence, event.shift)) return

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
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: 'column', width: '100%' }}
      >
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
                  <SelectableRow key={`${service.name}-${service.port}-${i}`} selected={isSelected}>
                    <StatusIndicator running={service.running} />
                    <text
                      content={
                        matchRanges.length > 0
                          ? buildHighlightedContent(labelText, matchRanges, isSelected)
                          : new StyledText([
                              ...stringToStyledText(labelText).chunks.map(chunk =>
                                isSelected ? bold(chunk) : chunk
                              ),
                            ])
                      }
                    />
                  </SelectableRow>
                )
              })}
          </>
        )}

        {services.some(s => s.type === 'host') && (
          <>
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
                  <SelectableRow key={`host-${service.port}`} selected={isSelected}>
                    <StatusIndicator running={service.running} />
                    <text
                      content={
                        matchRanges.length > 0
                          ? buildHighlightedContent(labelText, matchRanges, isSelected)
                          : new StyledText([
                              ...stringToStyledText(labelText).chunks.map(chunk =>
                                isSelected ? bold(chunk) : chunk
                              ),
                            ])
                      }
                    />
                  </SelectableRow>
                )
              })}
          </>
        )}

        {services.length === 0 && !loading && <text fg="#888888">No services configured</text>}
      </scrollbox>

      {/* Status message */}
      {statusMessage && (
        <text fg={statusMessage.type === 'success' ? '#00FF00' : '#FF4444'} flexShrink={0}>
          {statusMessage.text}
        </text>
      )}
    </box>
  )
}

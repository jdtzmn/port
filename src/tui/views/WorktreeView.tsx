import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import { StatusIndicator } from '../components/StatusIndicator.tsx'
import { KeyHints } from '../components/KeyHints.tsx'

interface WorktreeViewProps {
  worktree: WorktreeStatus | null
  hostServices: HostService[]
  config: PortConfig
  repoRoot: string
  onBack: () => void
  refresh: () => void
  loading: boolean
}

interface ServiceItem {
  type: 'docker' | 'host'
  name: string
  port: number
  running: boolean
  url: string
  /** Only for host services */
  pid?: number
  actualPort?: number
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
      // Services with no ports still show up, but with no URL
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
    })
  }

  return items
}

export function WorktreeView({
  worktree,
  hostServices,
  config,
  onBack,
  loading,
}: WorktreeViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const worktreeName = worktree?.name ?? 'unknown'
  const baseUrl = `http://${worktreeName}.${config.domain}`
  const services = buildServiceItems(worktree, hostServices, config, worktreeName)

  useKeyboard(event => {
    if (event.ctrl || event.meta) return

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
          // Open URL in default browser
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
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text>
          <b>{worktreeName}</b>
        </text>
        {loading && <text fg="#888888"> refreshing...</text>}
      </box>

      {/* URL */}
      <text fg="#00AAFF">{baseUrl}</text>

      <box height={1} />

      {/* Docker services section */}
      {services.some(s => s.type === 'docker') && (
        <>
          <text fg="#888888">
            <b>Docker Services</b>
          </text>

          {services
            .filter(s => s.type === 'docker')
            .map((service, i) => {
              // Find the actual index in the full services array
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

      {/* Spacer */}
      <box flexGrow={1} />

      {/* Key hints */}
      <KeyHints
        hints={[
          { key: 'Enter', action: 'open in browser' },
          { key: 'd', action: 'down' },
          { key: 'Esc', action: 'back' },
          { key: 'r', action: 'refresh' },
          { key: 'q', action: 'quit' },
        ]}
      />
    </box>
  )
}

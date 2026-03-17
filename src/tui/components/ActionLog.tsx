import type { ActionJob } from '../hooks/useActions.ts'

interface ActionLogProps {
  jobs: ActionJob[]
  activeJob: ActionJob | null
}

function renderStatus(status: ActionJob['status']): string {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'running':
      return 'running'
    case 'success':
      return 'success'
    case 'cancelled':
      return 'cancelled'
    case 'error':
      return 'error'
  }
}

function statusColor(status: ActionJob['status']): string {
  switch (status) {
    case 'running':
      return '#FFFF00'
    case 'success':
      return '#00FF00'
    case 'error':
      return '#FF4444'
    case 'cancelled':
      return '#FFAA00'
    default:
      return '#888888'
  }
}

export function ActionLog({ jobs, activeJob }: ActionLogProps) {
  const recentJobs = jobs.slice(0, 3)
  const activeLogs = activeJob?.logs.slice(-4) ?? []

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#888888">
        <b>Action Log</b>
      </text>

      {recentJobs.length === 0 && <text fg="#666666">No actions yet</text>}

      {recentJobs.map(job => (
        <box key={job.id} flexDirection="row" gap={1}>
          <text>{activeJob?.id === job.id ? '>' : ' '}</text>
          <text fg="#CCCCCC">{job.worktreeName}</text>
          <text fg="#888888">{job.kind}</text>
          <text fg={statusColor(job.status)}>{renderStatus(job.status)}</text>
        </box>
      ))}

      {activeJob && activeLogs.length > 0 && (
        <box flexDirection="column" gap={0}>
          {activeLogs.map((entry, index) => (
            <text
              key={`${activeJob.id}-line-${index}`}
              fg={entry.stream === 'stderr' ? '#FF8888' : '#888888'}
            >
              {entry.line}
            </text>
          ))}
        </box>
      )}
    </box>
  )
}

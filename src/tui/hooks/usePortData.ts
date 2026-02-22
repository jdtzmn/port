import { useState, useEffect, useCallback } from 'react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import { collectWorktreeStatuses } from '../../lib/worktreeStatus.ts'
import { getAllHostServices } from '../../lib/registry.ts'
import { isTraefikRunning } from '../../lib/compose.ts'
import { getComposeFile } from '../../lib/config.ts'
import { cleanupStaleHostServices } from '../../lib/hostService.ts'

export interface PortData {
  worktrees: WorktreeStatus[]
  hostServices: HostService[]
  traefikRunning: boolean
  loading: boolean
  error: string | null
  refresh: () => void
}

export function usePortData(repoRoot: string, config: PortConfig): PortData {
  const [worktrees, setWorktrees] = useState<WorktreeStatus[]>([])
  const [hostServices, setHostServices] = useState<HostService[]>([])
  const [traefikRunning, setTraefikRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await cleanupStaleHostServices()
      const composeFile = getComposeFile(config)
      const [statuses, services, traefik] = await Promise.all([
        collectWorktreeStatuses(repoRoot, composeFile, config.domain),
        getAllHostServices(),
        isTraefikRunning(),
      ])
      setWorktrees(statuses)
      // Filter host services to this repo
      setHostServices(services.filter(s => s.repo === repoRoot))
      setTraefikRunning(traefik)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [repoRoot, config])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { worktrees, hostServices, traefikRunning, loading, error, refresh: fetchData }
}

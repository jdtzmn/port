import { useState, useEffect, useCallback, useRef } from 'react'
import type { PortConfig, HostService } from '../../types.ts'
import type { WorktreeStatus } from '../../lib/worktreeStatus.ts'
import { getWorktreeSkeletons, fetchWorktreeServices } from '../../lib/worktreeStatus.ts'
import { getProjectName } from '../../lib/compose.ts'
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

  // Track the current fetch so we can discard stale results
  const fetchIdRef = useRef(0)

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)

    try {
      const composeFile = getComposeFile(config)

      // Phase 1: Instant — show worktree names from filesystem
      const skeletons = getWorktreeSkeletons(repoRoot)
      if (fetchId === fetchIdRef.current) {
        setWorktrees(skeletons)
      }

      // Phase 2: Parallel — fetch service status for all worktrees + global data
      const servicePromises = skeletons.map(async wt => {
        const projectName = getProjectName(repoRoot, wt.name)
        const services = await fetchWorktreeServices(
          repoRoot,
          wt.name,
          config.domain,
          wt.path,
          composeFile,
          projectName
        )
        return { name: wt.name, services }
      })

      // Fire all service fetches + global queries in parallel
      const globalPromise = Promise.all([
        cleanupStaleHostServices().then(() => getAllHostServices()),
        isTraefikRunning(),
      ])

      // Update each worktree as its service data arrives
      for (const promise of servicePromises) {
        promise.then(result => {
          if (fetchId !== fetchIdRef.current) return // stale
          setWorktrees(prev =>
            prev.map(wt =>
              wt.name === result.name
                ? {
                    ...wt,
                    services: result.services,
                    running: result.services.some(s => s.running),
                  }
                : wt
            )
          )
        })
      }

      // Wait for everything to finish before clearing the loading state
      const [allServices, [services, traefik]] = await Promise.all([
        Promise.all(servicePromises),
        globalPromise,
      ])

      if (fetchId !== fetchIdRef.current) return // stale

      // Final authoritative update with all data
      setWorktrees(
        skeletons.map(wt => {
          const result = allServices.find(r => r.name === wt.name)
          return result
            ? {
                ...wt,
                services: result.services,
                running: result.services.some(s => s.running),
              }
            : wt
        })
      )
      setHostServices(services.filter(s => s.repo === repoRoot))
      setTraefikRunning(traefik)
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [repoRoot, config])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { worktrees, hostServices, traefikRunning, loading, error, refresh: fetchData }
}

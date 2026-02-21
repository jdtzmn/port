import { listTasks, type PortTask } from './taskStore.ts'

export type TaskRefMatchType = 'display_id' | 'canonical_id' | 'canonical_prefix'

export type TaskRefResolution =
  | {
      ok: true
      task: PortTask
      matchedBy: TaskRefMatchType
    }
  | {
      ok: false
      kind: 'not_found'
      ref: string
    }
  | {
      ok: false
      kind: 'ambiguous'
      ref: string
      candidates: PortTask[]
    }

function isIntegerRef(ref: string): boolean {
  return /^\d+$/.test(ref)
}

function uniquePrefixMatches(tasks: PortTask[], ref: string): PortTask[] {
  const directMatches = tasks.filter(task => task.id.startsWith(ref))
  if (directMatches.length > 0) {
    return directMatches
  }

  if (ref.startsWith('task-')) {
    return []
  }

  return tasks.filter(task => task.id.startsWith(`task-${ref}`))
}

export async function resolveTaskRef(repoRoot: string, ref: string): Promise<TaskRefResolution> {
  const normalizedRef = ref.trim()
  if (!normalizedRef) {
    return {
      ok: false,
      kind: 'not_found',
      ref,
    }
  }

  const tasks = await listTasks(repoRoot)

  if (isIntegerRef(normalizedRef)) {
    const displayId = Number.parseInt(normalizedRef, 10)
    const byDisplayId = tasks.find(task => task.displayId === displayId)
    if (byDisplayId) {
      return {
        ok: true,
        task: byDisplayId,
        matchedBy: 'display_id',
      }
    }
  }

  const byCanonicalId = tasks.find(task => task.id === normalizedRef)
  if (byCanonicalId) {
    return {
      ok: true,
      task: byCanonicalId,
      matchedBy: 'canonical_id',
    }
  }

  const prefixMatches = uniquePrefixMatches(tasks, normalizedRef)
  if (prefixMatches.length === 1 && prefixMatches[0]) {
    return {
      ok: true,
      task: prefixMatches[0],
      matchedBy: 'canonical_prefix',
    }
  }

  if (prefixMatches.length > 1) {
    return {
      ok: false,
      kind: 'ambiguous',
      ref,
      candidates: prefixMatches,
    }
  }

  return {
    ok: false,
    kind: 'not_found',
    ref,
  }
}

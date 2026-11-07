import { accessSync, constants, realpathSync, statSync } from 'fs'
import { isAbsolute, join, relative, sep } from 'path'

export interface EnterDirectory {
  /** Directory the shell should end up in. */
  path: string
  /** True when path is the preserved subdirectory rather than the worktree root. */
  preserved: boolean
  /** Message explaining a preserved or fallback result; absent when entering from the root. */
  notice?: string
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** True when a relative path leaves its base ('..cache' is a normal name, not traversal). */
function escapes(rel: string): boolean {
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
}

/**
 * Decide which directory to enter in the target worktree so the user keeps the
 * same position they had in the source worktree (e.g. apps/web), falling back to
 * the target root when that directory cannot be used.
 *
 * Both source paths are physical (the process cwd and the git root found by
 * walking up from it), never the shell's logical $PWD.
 */
export function resolveEnterDirectory(options: {
  sourceRoot: string
  sourceCwd: string
  targetRoot: string
}): EnterDirectory {
  const { sourceRoot, sourceCwd, targetRoot } = options
  const root: EnterDirectory = { path: targetRoot, preserved: false }

  const rel = relative(canonical(sourceRoot), canonical(sourceCwd))
  if (rel === '' || escapes(rel)) return root

  const fallback = (reason: string): EnterDirectory => ({
    ...root,
    notice: `${rel} ${reason}; entering the worktree root instead`,
  })

  const candidate = join(targetRoot, rel)
  let isDirectory: boolean
  try {
    isDirectory = statSync(candidate).isDirectory()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return fallback(
      code === 'ENOENT' || code === 'ENOTDIR'
        ? 'does not exist in the target worktree'
        : 'cannot be accessed in the target worktree'
    )
  }
  if (!isDirectory) return fallback('is not a directory in the target worktree')

  let resolved: string
  try {
    resolved = realpathSync(candidate)
  } catch {
    return fallback('cannot be accessed in the target worktree')
  }
  if (escapes(relative(canonical(targetRoot), resolved))) {
    return fallback('resolves outside the target worktree')
  }

  // Being a directory is not enough: `cd` also needs search permission on it
  try {
    accessSync(candidate, constants.X_OK)
  } catch {
    return fallback('cannot be accessed in the target worktree')
  }

  return {
    path: candidate,
    preserved: true,
    notice: `Entering ${rel}, the same directory you were in before`,
  }
}

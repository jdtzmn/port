import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { resolveEnterDirectory } from './preserveCwd.ts'

describe('resolveEnterDirectory', () => {
  let base: string
  let source: string
  let target: string

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'port-preserve-cwd-')))
    source = join(base, 'source')
    target = join(base, 'target')
    mkdirSync(source)
    mkdirSync(target)
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  function mkdirIn(root: string, rel: string): string {
    const dir = join(root, rel)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  test('preserves the same relative directory when it exists in the target', () => {
    const cwd = mkdirIn(source, 'apps/web')
    mkdirIn(target, 'apps/web')

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(join(target, 'apps/web'))
    expect(result.preserved).toBe(true)
    expect(result.notice).toContain('apps/web')
  })

  test('stays quiet and uses the root when the source is the worktree root', () => {
    const result = resolveEnterDirectory({
      sourceRoot: source,
      sourceCwd: source,
      targetRoot: target,
    })

    expect(result).toEqual({ path: target, preserved: false })
  })

  test('falls back to the root with a notice when the directory is missing', () => {
    const cwd = mkdirIn(source, 'apps/web')

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(target)
    expect(result.preserved).toBe(false)
    expect(result.notice).toContain('apps/web does not exist in the target worktree')
  })

  test('falls back without saying "does not exist" when the target path is a file', () => {
    const cwd = mkdirIn(source, 'apps')
    writeFileSync(join(target, 'apps'), 'not a directory')

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(target)
    expect(result.notice).toContain('apps is not a directory in the target worktree')
    expect(result.notice).not.toContain('does not exist')
  })

  test('falls back when an ancestor of the directory is a file', () => {
    const cwd = mkdirIn(source, 'apps/web')
    writeFileSync(join(target, 'apps'), 'not a directory')

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(target)
    expect(result.notice).toContain('apps/web does not exist')
  })

  test('falls back quietly when the source is outside the source worktree root', () => {
    const outside = mkdirIn(base, 'elsewhere/apps')
    mkdirIn(target, 'apps')

    const result = resolveEnterDirectory({
      sourceRoot: source,
      sourceCwd: outside,
      targetRoot: target,
    })

    expect(result).toEqual({ path: target, preserved: false })
  })

  test('preserves directories with spaces and apostrophes', () => {
    const rel = "my dir/it's here"
    const cwd = mkdirIn(source, rel)
    mkdirIn(target, rel)

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(join(target, rel))
    expect(result.preserved).toBe(true)
  })

  test('treats a directory whose name starts with ".." as a normal directory', () => {
    const cwd = mkdirIn(source, '..cache')
    mkdirIn(target, '..cache')

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(join(target, '..cache'))
    expect(result.preserved).toBe(true)
  })

  test('falls back when the target directory is a symlink leaving the worktree', () => {
    const cwd = mkdirIn(source, 'apps/web')
    const outside = mkdirIn(base, 'outside')
    mkdirIn(target, 'apps')
    symlinkSync(outside, join(target, 'apps/web'))

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(target)
    expect(result.notice).toContain('apps/web resolves outside the target worktree')
  })

  test('rejects a symlink into a sibling directory sharing the worktree name prefix', () => {
    const cwd = mkdirIn(source, 'apps/web')
    const sibling = mkdirIn(base, 'target-other/apps/web')
    mkdirIn(target, 'apps')
    symlinkSync(sibling, join(target, 'apps/web'))

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(target)
    expect(result.preserved).toBe(false)
    expect(result.notice).toContain('resolves outside the target worktree')
  })

  test('allows a symlink that stays inside the worktree', () => {
    const cwd = mkdirIn(source, 'apps/web')
    mkdirIn(target, 'real/web')
    mkdirIn(target, 'apps')
    symlinkSync(join(target, 'real/web'), join(target, 'apps/web'))

    const result = resolveEnterDirectory({ sourceRoot: source, sourceCwd: cwd, targetRoot: target })

    expect(result.path).toBe(join(target, 'apps/web'))
    expect(result.preserved).toBe(true)
  })

  test('works when the target root is reached through a symlinked path', () => {
    const cwd = mkdirIn(source, 'apps/web')
    mkdirIn(target, 'apps/web')
    const targetAlias = join(base, 'target-alias')
    symlinkSync(target, targetAlias)

    const result = resolveEnterDirectory({
      sourceRoot: source,
      sourceCwd: cwd,
      targetRoot: targetAlias,
    })

    expect(result.path).toBe(join(targetAlias, 'apps/web'))
    expect(result.preserved).toBe(true)
  })

  test('works when the source root is given as a symlink alias of the physical cwd', () => {
    const cwd = mkdirIn(source, 'apps/web')
    mkdirIn(target, 'apps/web')
    const sourceAlias = join(base, 'source-alias')
    symlinkSync(source, sourceAlias)

    const result = resolveEnterDirectory({
      sourceRoot: sourceAlias,
      sourceCwd: cwd,
      targetRoot: target,
    })

    expect(result.path).toBe(join(target, 'apps/web'))
    expect(result.preserved).toBe(true)
  })
})

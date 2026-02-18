import { join } from 'path'
import { existsSync } from 'fs'
import { test, expect } from 'vitest'
import { execPortAsync, prepareSample } from './utils'

const TIMEOUT = 60000

test(
  'can switch worktrees from within a worktree (sibling, not nested)',
  async () => {
    const sample = await prepareSample('simple-server', {
      initWithConfig: true,
    })

    // 1. Enter worktree demo-1 from the repo root
    await execPortAsync(['demo-1', '--no-shell'], sample.dir)

    // 2. Verify demo-1 was created
    const demo1Path = join(sample.dir, '.port/trees/demo-1')
    expect(existsSync(demo1Path)).toBe(true)

    // 3. From within demo-1, enter worktree demo-2
    await execPortAsync(['demo-2', '--no-shell'], demo1Path)

    // 4. Verify demo-2 was created as a sibling (at .port/trees/demo-2)
    const demo2Path = join(sample.dir, '.port/trees/demo-2')
    expect(existsSync(demo2Path)).toBe(true)

    // 5. Verify demo-2 was NOT created nested inside demo-1
    const nestedPath = join(demo1Path, '.port/trees/demo-2')
    expect(existsSync(nestedPath)).toBe(false)

    await sample.cleanup()
  },
  TIMEOUT
)

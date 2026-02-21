import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'vitest'
import { readDaemonState, runTaskDaemon, stopTaskDaemon } from './taskDaemon.ts'

const tempDirs = new Set<string>()

function makeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'port-task-daemon-test-'))
  tempDirs.add(root)
  return root
}

afterEach(async () => {
  await Promise.all(Array.from(tempDirs).map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.clear()
})

describe('taskDaemon', () => {
  test('returns not running when daemon state is absent', async () => {
    const repoRoot = makeRepoRoot()
    const result = await stopTaskDaemon(repoRoot)

    expect(result).toEqual({ stopped: false, reason: 'not_running' })
  })

  test('writes daemon state and exits after idle timeout', async () => {
    const repoRoot = makeRepoRoot()
    await runTaskDaemon(repoRoot, { idleStopMs: 10 })

    const state = await readDaemonState(repoRoot)
    expect(state?.status).toBe('stopping')
    expect(state?.pid).toBe(process.pid)
  })
})

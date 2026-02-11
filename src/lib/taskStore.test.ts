import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, test } from 'vitest'
import { countActiveTasks, createTask, getTask, listTasks, updateTaskStatus } from './taskStore.ts'

const tempDirs = new Set<string>()

function makeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'port-task-store-test-'))
  tempDirs.add(root)
  return root
}

afterEach(async () => {
  await Promise.all(Array.from(tempDirs).map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.clear()
})

describe('taskStore', () => {
  test('creates and lists tasks in reverse creation order', async () => {
    const repoRoot = makeRepoRoot()

    const first = await createTask(repoRoot, { title: 'first task' })
    const second = await createTask(repoRoot, { title: 'second task', mode: 'read' })

    const tasks = await listTasks(repoRoot)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.id).toBe(second.id)
    expect(tasks[1]?.id).toBe(first.id)
    expect(tasks[0]?.mode).toBe('read')
  })

  test('updates status and can fetch by id', async () => {
    const repoRoot = makeRepoRoot()
    const task = await createTask(repoRoot, { title: 'status change' })

    const updated = await updateTaskStatus(repoRoot, task.id, 'running', 'started by daemon')
    expect(updated?.status).toBe('running')

    const fetched = await getTask(repoRoot, task.id)
    expect(fetched?.status).toBe('running')
  })

  test('counts queued and running tasks as active', async () => {
    const repoRoot = makeRepoRoot()
    const queued = await createTask(repoRoot, { title: 'queued' })
    const running = await createTask(repoRoot, { title: 'running' })

    await updateTaskStatus(repoRoot, running.id, 'running')
    await updateTaskStatus(repoRoot, queued.id, 'completed')

    expect(await countActiveTasks(repoRoot)).toBe(1)
  })
})

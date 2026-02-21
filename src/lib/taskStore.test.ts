import { mkdtempSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
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
    expect(first.displayId).toBe(1)
    expect(second.displayId).toBe(2)
  })

  test('migrates legacy index data to v3 display ids and nextDisplayId', async () => {
    const repoRoot = makeRepoRoot()
    const jobsDir = join(repoRoot, '.port', 'jobs')
    const indexPath = join(jobsDir, 'index.json')

    await mkdir(jobsDir, { recursive: true })
    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          version: 2,
          tasks: [
            {
              id: 'task-later',
              title: 'later task',
              mode: 'write',
              status: 'queued',
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
            {
              id: 'task-earlier',
              title: 'earlier task',
              mode: 'write',
              status: 'queued',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2
      )}\n`
    )

    const tasks = await listTasks(repoRoot)
    const earlier = tasks.find(task => task.id === 'task-earlier')
    const later = tasks.find(task => task.id === 'task-later')

    expect(earlier?.displayId).toBe(1)
    expect(later?.displayId).toBe(2)

    const raw = await readFile(indexPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      version: number
      nextDisplayId: number
      tasks: Array<{ id: string; displayId: number }>
    }

    expect(parsed.version).toBe(3)
    expect(parsed.nextDisplayId).toBe(3)
    expect(parsed.tasks.find(task => task.id === 'task-earlier')?.displayId).toBe(1)
    expect(parsed.tasks.find(task => task.id === 'task-later')?.displayId).toBe(2)
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

  test('queues write tasks for the same branch behind the first active task', async () => {
    const repoRoot = makeRepoRoot()
    const first = await createTask(repoRoot, {
      title: 'first write',
      mode: 'write',
      branch: 'feature-a',
    })
    const second = await createTask(repoRoot, {
      title: 'second write',
      mode: 'write',
      branch: 'feature-a',
    })

    const initialFirst = await getTask(repoRoot, first.id)
    const initialSecond = await getTask(repoRoot, second.id)

    expect(initialFirst?.queue?.lockKey).toBe('feature-a')
    expect(initialFirst?.queue?.blockedByTaskId).toBeUndefined()
    expect(initialSecond?.queue?.blockedByTaskId).toBe(first.id)

    await updateTaskStatus(repoRoot, first.id, 'completed')

    const unblockedSecond = await getTask(repoRoot, second.id)
    expect(unblockedSecond?.queue?.blockedByTaskId).toBeUndefined()
  })
})

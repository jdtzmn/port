import { mkdtempSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, test } from 'vitest'
import { createTask } from './taskStore.ts'
import { resolveTaskRef } from './taskId.ts'

const tempDirs = new Set<string>()

function makeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'port-task-id-test-'))
  tempDirs.add(root)
  return root
}

async function seedTaskIndex(repoRoot: string, payload: unknown): Promise<void> {
  const jobsDir = join(repoRoot, '.port', 'jobs')
  await mkdir(jobsDir, { recursive: true })
  await writeFile(join(jobsDir, 'index.json'), `${JSON.stringify(payload, null, 2)}\n`)
}

afterEach(async () => {
  await Promise.all(Array.from(tempDirs).map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.clear()
})

describe('taskId resolver', () => {
  test('resolves numeric display id first', async () => {
    const repoRoot = makeRepoRoot()
    const task = await createTask(repoRoot, { title: 'display-id target' })

    const resolution = await resolveTaskRef(repoRoot, String(task.displayId))
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.task.id).toBe(task.id)
      expect(resolution.matchedBy).toBe('display_id')
    }
  })

  test('resolves canonical id exactly', async () => {
    const repoRoot = makeRepoRoot()
    const task = await createTask(repoRoot, { title: 'canonical-id target' })

    const resolution = await resolveTaskRef(repoRoot, task.id)
    expect(resolution.ok).toBe(true)
    if (resolution.ok) {
      expect(resolution.task.id).toBe(task.id)
      expect(resolution.matchedBy).toBe('canonical_id')
    }
  })

  test('resolves unique canonical prefix with and without task- prefix', async () => {
    const repoRoot = makeRepoRoot()
    await seedTaskIndex(repoRoot, {
      version: 3,
      nextDisplayId: 3,
      tasks: [
        {
          id: 'task-abc12345',
          displayId: 1,
          title: 'first',
          mode: 'write',
          status: 'queued',
          adapter: 'local',
          capabilities: {
            supportsCheckpoint: false,
            supportsRestore: false,
            supportsAttachHandoff: false,
            supportsResumeToken: false,
            supportsTranscript: false,
            supportsFailedSnapshot: false,
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'task-def67890',
          displayId: 2,
          title: 'second',
          mode: 'write',
          status: 'queued',
          adapter: 'local',
          capabilities: {
            supportsCheckpoint: false,
            supportsRestore: false,
            supportsAttachHandoff: false,
            supportsResumeToken: false,
            supportsTranscript: false,
            supportsFailedSnapshot: false,
          },
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })

    const shortPrefix = await resolveTaskRef(repoRoot, 'abc1')
    expect(shortPrefix.ok).toBe(true)
    if (shortPrefix.ok) {
      expect(shortPrefix.task.id).toBe('task-abc12345')
      expect(shortPrefix.matchedBy).toBe('canonical_prefix')
    }

    const taskPrefix = await resolveTaskRef(repoRoot, 'task-def6')
    expect(taskPrefix.ok).toBe(true)
    if (taskPrefix.ok) {
      expect(taskPrefix.task.id).toBe('task-def67890')
      expect(taskPrefix.matchedBy).toBe('canonical_prefix')
    }
  })

  test('returns ambiguity details for non-unique prefixes', async () => {
    const repoRoot = makeRepoRoot()
    await seedTaskIndex(repoRoot, {
      version: 3,
      nextDisplayId: 3,
      tasks: [
        {
          id: 'task-abc11111',
          displayId: 1,
          title: 'first',
          mode: 'write',
          status: 'queued',
          adapter: 'local',
          capabilities: {
            supportsCheckpoint: false,
            supportsRestore: false,
            supportsAttachHandoff: false,
            supportsResumeToken: false,
            supportsTranscript: false,
            supportsFailedSnapshot: false,
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'task-abc22222',
          displayId: 2,
          title: 'second',
          mode: 'write',
          status: 'queued',
          adapter: 'local',
          capabilities: {
            supportsCheckpoint: false,
            supportsRestore: false,
            supportsAttachHandoff: false,
            supportsResumeToken: false,
            supportsTranscript: false,
            supportsFailedSnapshot: false,
          },
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })

    const resolution = await resolveTaskRef(repoRoot, 'abc')
    expect(resolution.ok).toBe(false)
    if (!resolution.ok) {
      expect(resolution.kind).toBe('ambiguous')
      if (resolution.kind === 'ambiguous') {
        expect(resolution.candidates).toHaveLength(2)
      }
    }
  })

  test('returns not_found when no match exists', async () => {
    const repoRoot = makeRepoRoot()
    await createTask(repoRoot, { title: 'exists' })

    const resolution = await resolveTaskRef(repoRoot, '9999')
    expect(resolution.ok).toBe(false)
    if (!resolution.ok) {
      expect(resolution.kind).toBe('not_found')
    }
  })
})

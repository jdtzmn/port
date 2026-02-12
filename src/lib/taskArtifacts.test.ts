import { mkdtempSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  appendTaskStderr,
  appendTaskStdout,
  readTaskCommitRefs,
  writeTaskCommitRefs,
  writeTaskMetadata,
} from './taskArtifacts.ts'

const tempDirs = new Set<string>()

function makeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'port-task-artifacts-test-'))
  tempDirs.add(root)
  return root
}

afterEach(async () => {
  await Promise.all(Array.from(tempDirs).map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.clear()
})

describe('taskArtifacts', () => {
  test('writes metadata and log artifacts', async () => {
    const repoRoot = makeRepoRoot()
    await writeTaskMetadata(repoRoot, {
      id: 'task-1',
      title: 'demo',
      mode: 'write',
      status: 'completed',
      adapter: 'local',
      capabilities: {
        supportsAttachHandoff: false,
        supportsResumeToken: false,
        supportsTranscript: false,
        supportsFailedSnapshot: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await appendTaskStdout(repoRoot, 'task-1', 'hello stdout')
    await appendTaskStderr(repoRoot, 'task-1', 'hello stderr')

    const metadata = await readFile(
      join(repoRoot, '.port/jobs/artifacts/task-1/metadata.json'),
      'utf-8'
    )
    expect(metadata).toContain('"task-1"')
  })

  test('writes and reads commit refs', async () => {
    const repoRoot = makeRepoRoot()

    await writeTaskCommitRefs(repoRoot, 'task-2', ['abc', 'def'])
    const commits = await readTaskCommitRefs(repoRoot, 'task-2')

    expect(commits).toEqual(['abc', 'def'])
  })
})

import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { execFileAsync } from './exec.ts'
import type { PortTask } from './taskStore.ts'

const ARTIFACTS_DIR = 'artifacts'

export interface TaskMetadata {
  id: string
  title: string
  mode: string
  status: string
  adapter: string
  createdAt: string
  updatedAt: string
  runtime?: PortTask['runtime']
}

function getJobsDir(repoRoot: string): string {
  return join(repoRoot, '.port', 'jobs')
}

export function getTaskArtifactsDir(repoRoot: string, taskId: string): string {
  return join(getJobsDir(repoRoot), ARTIFACTS_DIR, taskId)
}

function getMetadataPath(repoRoot: string, taskId: string): string {
  return join(getTaskArtifactsDir(repoRoot, taskId), 'metadata.json')
}

function getCommitRefsPath(repoRoot: string, taskId: string): string {
  return join(getTaskArtifactsDir(repoRoot, taskId), 'commit-refs.json')
}

function getPatchPath(repoRoot: string, taskId: string): string {
  return join(getTaskArtifactsDir(repoRoot, taskId), 'changes.patch')
}

function getStdoutPath(repoRoot: string, taskId: string): string {
  return join(getTaskArtifactsDir(repoRoot, taskId), 'stdout.log')
}

function getStderrPath(repoRoot: string, taskId: string): string {
  return join(getTaskArtifactsDir(repoRoot, taskId), 'stderr.log')
}

function getBundlePath(repoRoot: string, taskId: string): string {
  return join(getTaskArtifactsDir(repoRoot, taskId), 'changes.bundle')
}

export async function ensureTaskArtifacts(repoRoot: string, taskId: string): Promise<void> {
  await mkdir(getTaskArtifactsDir(repoRoot, taskId), { recursive: true })
}

export async function writeTaskMetadata(repoRoot: string, task: PortTask): Promise<void> {
  await ensureTaskArtifacts(repoRoot, task.id)
  const metadata: TaskMetadata = {
    id: task.id,
    title: task.title,
    mode: task.mode,
    status: task.status,
    adapter: task.adapter,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    runtime: task.runtime,
  }
  await writeFile(getMetadataPath(repoRoot, task.id), `${JSON.stringify(metadata, null, 2)}\n`)
}

export async function appendTaskStdout(
  repoRoot: string,
  taskId: string,
  line: string
): Promise<void> {
  await ensureTaskArtifacts(repoRoot, taskId)
  await appendFile(getStdoutPath(repoRoot, taskId), `${line}\n`)
}

export async function appendTaskStderr(
  repoRoot: string,
  taskId: string,
  line: string
): Promise<void> {
  await ensureTaskArtifacts(repoRoot, taskId)
  await appendFile(getStderrPath(repoRoot, taskId), `${line}\n`)
}

export async function writeTaskCommitRefs(
  repoRoot: string,
  taskId: string,
  commits: string[]
): Promise<void> {
  await ensureTaskArtifacts(repoRoot, taskId)
  await writeFile(getCommitRefsPath(repoRoot, taskId), `${JSON.stringify({ commits }, null, 2)}\n`)
}

export async function writeTaskPatchFromWorktree(
  repoRoot: string,
  taskId: string,
  worktreePath: string
): Promise<void> {
  await ensureTaskArtifacts(repoRoot, taskId)

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--binary'], { cwd: worktreePath })
    await writeFile(getPatchPath(repoRoot, taskId), stdout)
  } catch {
    await writeFile(getPatchPath(repoRoot, taskId), '')
  }
}

export async function readTaskCommitRefs(repoRoot: string, taskId: string): Promise<string[]> {
  const refsPath = getCommitRefsPath(repoRoot, taskId)
  if (!existsSync(refsPath)) {
    return []
  }

  try {
    const raw = await readFile(refsPath, 'utf-8')
    const parsed = JSON.parse(raw) as { commits?: string[] }
    return Array.isArray(parsed.commits) ? parsed.commits : []
  } catch {
    return []
  }
}

export function getTaskPatchPath(repoRoot: string, taskId: string): string {
  return getPatchPath(repoRoot, taskId)
}

export function getTaskBundlePath(repoRoot: string, taskId: string): string {
  return getBundlePath(repoRoot, taskId)
}

export function hasTaskBundle(repoRoot: string, taskId: string): boolean {
  return existsSync(getTaskBundlePath(repoRoot, taskId))
}

export function getTaskStdoutPath(repoRoot: string, taskId: string): string {
  return getStdoutPath(repoRoot, taskId)
}

export function getTaskStderrPath(repoRoot: string, taskId: string): string {
  return getStderrPath(repoRoot, taskId)
}

export function listTaskArtifactPaths(repoRoot: string, taskId: string): string[] {
  return [
    getMetadataPath(repoRoot, taskId),
    getCommitRefsPath(repoRoot, taskId),
    getPatchPath(repoRoot, taskId),
    getStdoutPath(repoRoot, taskId),
    getStderrPath(repoRoot, taskId),
  ]
}

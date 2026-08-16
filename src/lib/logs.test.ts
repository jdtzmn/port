import { existsSync } from 'fs'
import { mkdtempSync } from 'fs'
import { rm, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { LATEST_LOG, LOGS_DIR, PORT_DIR } from './config.ts'
import { ensureLogsDir, getLogPath, getLogsDir, getServiceLogPath } from './logs.ts'

describe('log paths', () => {
  const repoRoot = '/repos/example'

  test('getLogsDir resolves inside the port directory', () => {
    expect(getLogsDir(repoRoot)).toBe(join(repoRoot, PORT_DIR, LOGS_DIR))
  })

  test('getLogPath resolves the latest log file', () => {
    expect(getLogPath(repoRoot)).toBe(join(repoRoot, PORT_DIR, LOGS_DIR, LATEST_LOG))
  })

  test('getServiceLogPath is namespaced by branch and logical port', () => {
    expect(getServiceLogPath(repoRoot, 'feature-1', 3000)).toBe(
      join(repoRoot, PORT_DIR, LOGS_DIR, 'feature-1-3000.log')
    )
  })

  test('getServiceLogPath keeps distinct paths per branch and port', () => {
    const paths = new Set([
      getServiceLogPath(repoRoot, 'feature-1', 3000),
      getServiceLogPath(repoRoot, 'feature-1', 3001),
      getServiceLogPath(repoRoot, 'feature-2', 3000),
    ])

    expect(paths.size).toBe(3)
  })

  test('getServiceLogPath flattens branch names containing slashes', () => {
    expect(getServiceLogPath(repoRoot, 'feature/nested', 3000)).toBe(
      join(repoRoot, PORT_DIR, LOGS_DIR, 'feature-nested-3000.log')
    )
  })
})

describe('ensureLogsDir', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'port-logs-test-'))
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('creates the logs directory when missing', async () => {
    expect(existsSync(getLogsDir(repoRoot))).toBe(false)

    await ensureLogsDir(repoRoot)

    expect((await stat(getLogsDir(repoRoot))).isDirectory()).toBe(true)
  })

  test('is idempotent when the logs directory already exists', async () => {
    await ensureLogsDir(repoRoot)
    await expect(ensureLogsDir(repoRoot)).resolves.toBeUndefined()

    expect((await stat(getLogsDir(repoRoot))).isDirectory()).toBe(true)
  })
})

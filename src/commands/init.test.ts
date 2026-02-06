import path from 'path'
import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { prepareSample, renderCLI } from '@tests/utils'
import { existsSync } from 'fs'
import { execAsync } from '../lib/exec.ts'

describe('Git repo detection tests', () => {
  test('should fail when not in a git repo', async () => {
    const sample = await prepareSample('db-and-server')

    const { findByError } = await renderCLI(['init'], sample.dir)

    const instance = await findByError('Not in a git repository')
    expect(instance).toBeInTheConsole()
    await sample.cleanup()
  })

  test('should succeed when in a git repo', async () => {
    const sample = await prepareSample('db-and-server', {
      gitInit: true,
    })

    const { findByText } = await renderCLI(['init'], sample.dir)

    const instance = await findByText('Initialization complete')
    expect(instance).toBeInTheConsole()
    await sample.cleanup()
  })
})

describe('Directory creation tests', () => {
  let sampleDir: string
  let sampleCleanup: () => void
  beforeEach(async () => {
    const sample = await prepareSample('db-and-server')
    await execAsync('git init', {
      cwd: sample.dir,
    })
    sampleDir = sample.dir
    sampleCleanup = sample.cleanup
  })
  afterEach(async () => {
    sampleCleanup()
  })

  test('should create the `.port` directory', async () => {
    expect(existsSync(path.join(sampleDir, '.port'))).toBeFalsy()
    const { findByText } = await renderCLI(['init'], sampleDir)

    await findByText('Initialization complete')
    expect(existsSync(path.join(sampleDir, '.port'))).toBeTruthy()
  })

  test('should create the user override compose scaffold', async () => {
    expect(existsSync(path.join(sampleDir, '.port', 'override-compose.yml'))).toBeFalsy()

    const { findByText } = await renderCLI(['init'], sampleDir)
    await findByText('Initialization complete')

    expect(existsSync(path.join(sampleDir, '.port', 'override-compose.yml'))).toBeTruthy()
  })
})

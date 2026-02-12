import path from 'path'
import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { prepareSample, renderCLI } from '@tests/utils'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
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

    const instance = await findByText('Initialization complete', {}, { timeout: 10000 })
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

    await findByText('Initialization complete', {}, { timeout: 10000 })
    expect(existsSync(path.join(sampleDir, '.port'))).toBeTruthy()
  })

  test('should create the user override compose scaffold', async () => {
    expect(existsSync(path.join(sampleDir, '.port', 'override-compose.yml'))).toBeFalsy()

    const { findByText } = await renderCLI(['init'], sampleDir)
    await findByText('Initialization complete', {}, { timeout: 10000 })

    expect(existsSync(path.join(sampleDir, '.port', 'override-compose.yml'))).toBeTruthy()
  })

  test('should scaffold task and remote config namespaces', async () => {
    const { findByText } = await renderCLI(['init'], sampleDir)
    await findByText('Initialization complete', {}, { timeout: 10000 })

    const configText = await readFile(path.join(sampleDir, '.port', 'config.jsonc'), 'utf-8')
    expect(configText).toContain('"task"')
    expect(configText).toContain('"remote"')
  })

  test('should update existing .port/.gitignore with required entries', async () => {
    const portDir = path.join(sampleDir, '.port')
    await mkdir(portDir, { recursive: true })
    await writeFile(path.join(portDir, '.gitignore'), 'trees/\nlogs/\n')

    const { findByText } = await renderCLI(['init'], sampleDir)
    await findByText('Initialization complete', {}, { timeout: 10000 })

    const gitignoreText = await readFile(path.join(portDir, '.gitignore'), 'utf-8')
    expect(gitignoreText).toContain('override.yml')
    expect(gitignoreText).toContain('override.user.yml')
    expect(gitignoreText).toContain('jobs/')
  })
})

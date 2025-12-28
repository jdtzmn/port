import path from 'path'
import { test, expect, describe } from 'vitest'
import { prepareSample, renderCLI } from '@tests/utils'
import { existsSync } from 'fs'

describe('Git repo detection tests', () => {
  test('should fail when not in a git repo', async () => {
    const sample = await prepareSample('db-and-server')
    expect(existsSync(path.join(sample.dir, '/.git'))).not.toBe(true)

    const { findByError } = await renderCLI(['init'], sample.dir)

    const instance = await findByError('Not in a git repository')
    expect(instance).toBeInTheConsole()
    sample.cleanup()
  })
})

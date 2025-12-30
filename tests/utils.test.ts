import { describe, test, expect } from 'vitest'
import { prepareSample } from './utils'
import { existsSync, readFileSync } from 'fs'

describe('Basic tests', () => {
  test('prepareSample can create a temp directory', async () => {
    const sample = await prepareSample('db-and-server')
    expect(sample.dir).toBeDefined()
    expect(sample.cleanup).toBeDefined()
    sample.cleanup()
  })

  test('prepareSample creates a directory that exists', async () => {
    const sample = await prepareSample('db-and-server')
    expect(existsSync(sample.dir)).toBe(true)
    sample.cleanup()
  })

  test('prepareSample directory is removed after cleanup', async () => {
    const sample = await prepareSample('db-and-server')
    expect(existsSync(sample.dir)).toBe(true)
    sample.cleanup()
    expect(existsSync(sample.dir)).toBe(false)
  })
})

describe('Side effects', () => {
  test('`.git` directory or `.port` directory are not created by default', async () => {
    const sample = await prepareSample('db-and-server')
    expect(existsSync(`${sample.dir}/.git`)).toBe(false)
    expect(existsSync(`${sample.dir}/.port`)).toBe(false)
    sample.cleanup()
  })

  test('creates a `.git` directory', async () => {
    const sample = await prepareSample('db-and-server', { gitInit: true })
    expect(existsSync(`${sample.dir}/.git`)).toBe(true)
    sample.cleanup()
  })

  test('creates a `.port` directory', async () => {
    const sample = await prepareSample('db-and-server', { initWithConfig: true })
    expect(existsSync(`${sample.dir}/.port`)).toBe(true)
    sample.cleanup()
  })

  test('initializes with provided config', async () => {
    const sample = await prepareSample('db-and-server', { initWithConfig: { domain: 'test' } })
    expect(existsSync(`${sample.dir}/.port`)).toBe(true)
    const fileContents = readFileSync(`${sample.dir}/.port/config.jsonc`, 'utf8')
    expect(fileContents).toEqual(JSON.stringify({ domain: 'test' }, undefined, 2))
    sample.cleanup()
  })
})

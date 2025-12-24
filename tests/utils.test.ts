import { test, expect } from 'vitest'
import { prepareSample } from './utils'
import { existsSync } from 'fs'

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

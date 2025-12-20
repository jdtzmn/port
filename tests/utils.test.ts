import { test, expect } from 'vitest'
import { prepareSample } from './utils'

test('prepareSample', async () => {
  const sample = await prepareSample('db-and-server')
  expect(sample.dir).toBeDefined()
  expect(sample.cleanup).toBeDefined()
})

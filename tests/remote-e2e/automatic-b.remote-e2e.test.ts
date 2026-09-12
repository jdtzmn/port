import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('remote B publishes and removes automatic product routes', () => {
  runRemoteScenario('automatic-runtime-b', 240, 'bootstrap', ['--automatic-runtime', 'remote-b'])
})

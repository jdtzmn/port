import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('remote A publishes and removes automatic product routes', () => {
  runRemoteScenario('automatic-runtime-a', 240, 'bootstrap', ['--automatic-runtime', 'remote-a'])
})

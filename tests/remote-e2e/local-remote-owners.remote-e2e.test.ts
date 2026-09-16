import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('a disconnected remote owner joins local and remote conflicts', () => {
  runRemoteScenario('local-remote-owners', 300, 'bootstrap', ['--local-remote-owners'])
})

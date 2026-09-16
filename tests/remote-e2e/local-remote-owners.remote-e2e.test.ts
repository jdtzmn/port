import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('local and remote owners publish exact three-way conflicts', () => {
  runRemoteScenario('local-remote-owners', 300, 'bootstrap', ['--local-remote-owners'])
})

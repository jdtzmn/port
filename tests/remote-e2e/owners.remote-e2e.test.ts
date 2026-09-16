import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('simultaneous owners fail closed and recover after disconnect', () => {
  runRemoteScenario('concurrent-owners', 300, 'bootstrap', ['--concurrent-owners'])
})

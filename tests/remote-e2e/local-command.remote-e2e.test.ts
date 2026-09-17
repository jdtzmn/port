import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('host-scoped LocalCommand follows the finite ControlMaster lifecycle', () => {
  runRemoteScenario('local-command-lifecycle', 90, 'local_command')
})

test('production managed SSH config registers and self-cleans', () => {
  runRemoteScenario('managed-local-command', 90, 'managed_local_command')
})

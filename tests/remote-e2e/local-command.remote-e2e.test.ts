import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('host-scoped LocalCommand follows the finite ControlMaster lifecycle', () => {
  runRemoteScenario('local-command-lifecycle', 45, 'local_command')
})

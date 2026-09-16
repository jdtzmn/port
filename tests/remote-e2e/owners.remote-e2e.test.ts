import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('remote conflicts recover before adding a local owner', () => {
  runRemoteScenario('owner-matrix', 360, 'bootstrap', ['--owner-matrix'])
})

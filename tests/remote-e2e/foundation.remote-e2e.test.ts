import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('ordinary SSH bootstraps discovery and preserves SSH compatibility', () => {
  runRemoteScenario('bootstrap-foundation', 240, 'bootstrap', ['--foundation-only'])
})

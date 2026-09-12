import { test } from 'vitest'
import { runRemoteCommand, runRemoteScenario } from './remote-e2e'

test('ordinary login survives a remote without Port installed', () => {
  try {
    runRemoteCommand('missing-port-disable', 10, 'remote-b', [
      'mv',
      '/usr/local/bin/port',
      '/usr/local/bin/port-unavailable',
    ])
    runRemoteScenario('missing-port-bootstrap', 90, 'bootstrap', ['--missing-port-only'])
  } finally {
    runRemoteCommand('missing-port-restore', 10, 'remote-b', [
      'sh',
      '-c',
      'if [ -e /usr/local/bin/port-unavailable ]; then mv /usr/local/bin/port-unavailable /usr/local/bin/port; fi',
    ])
  }
})

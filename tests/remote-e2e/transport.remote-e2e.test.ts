import { test } from 'vitest'
import { runRemoteScenario } from './remote-e2e'

test('interactive SSH tunnels reach isolated databases and Docker', () => {
  runRemoteScenario('transport', 150, 'harness')
})

test('SSH multiplexing preserves login ownership and cleanup', () => {
  runRemoteScenario('multiplexing', 90, 'mux')
})

test('Traefik routes HTTP and PostgreSQL by hostname', () => {
  runRemoteScenario('baseline', 90, 'baseline')
})

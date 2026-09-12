import { defineConfig } from 'vitest/config'
import RemoteE2ESequencer from './remote-e2e-sequencer'

export default defineConfig({
  test: {
    name: 'remote-e2e',
    include: ['tests/remote-e2e/*.remote-e2e.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 330_000,
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
    sequence: {
      sequencer: RemoteE2ESequencer,
    },
  },
})

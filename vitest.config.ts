import { availableParallelism } from 'os'
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/.port/**'],
    // CI runs Docker-heavy integration tests that share Traefik/DNS state.
    // Keep workers at 1 in CI to avoid cross-test contention and startup
    // timeouts on smaller runners.
    maxWorkers: process.env.CI ? 1 : Math.max(1, availableParallelism() - 1),
  },
  resolve: {
    alias: {
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
})

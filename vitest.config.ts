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
    // Reserve one core for Docker containers, Traefik, and other child
    // processes spawned by integration tests.  Without this cap the default
    // (all available cores) lets multiple heavy test files run concurrently,
    // which on a 2-core CI runner starves the containers and causes timeouts.
    maxWorkers: Math.max(1, availableParallelism() - 1),
  },
  resolve: {
    alias: {
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
})

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
    maxWorkers: Math.max(1, Math.floor(availableParallelism() / 2)),
  },
  resolve: {
    alias: {
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
})

import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/.port/**'],
  },
  resolve: {
    alias: {
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
})

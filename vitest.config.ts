import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest-setup.ts'],
  },
  resolve: {
    alias: {
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
})

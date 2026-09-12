import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/remote-e2e/*.unit.test.ts'],
    environment: 'node',
    maxWorkers: 1,
  },
})

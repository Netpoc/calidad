import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // env.ts refuses to start without JWT_SECRET; the integration suites boot
    // the real app, so it must be present before any module is imported.
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-at-least-16-chars',
      MONGODB_URI: 'mongodb://127.0.0.1:1/unused',
    },
    testTimeout: 30_000,
    // First run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
    // Suites share the mongoose singleton, so they must not run in parallel.
    fileParallelism: false,
  },
})

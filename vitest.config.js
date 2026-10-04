import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    // Silence winston during tests; individual tests can override.
    env: {
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
    // Run each file in its own worker so mongoose state is isolated.
    pool: 'forks',
    include: [
      'tests/**/*.test.js',
      'server-app/src/**/*.test.js',
    ],
  },
});

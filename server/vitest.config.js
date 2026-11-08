import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    setupFiles: ['test/helpers/setup.js'],
    // Each test file gets fresh modules, so each gets its own temp database.
    isolate: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/index.js'], // only calls app.listen()
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});

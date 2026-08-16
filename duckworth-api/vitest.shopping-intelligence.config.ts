import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['../packages/shopping-intelligence/src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    fileParallelism: false,
  },
});

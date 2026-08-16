import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    fileParallelism: false,
  },
});

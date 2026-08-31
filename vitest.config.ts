import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tools/**', 'node_modules/**', 'dist/**']
  }
});

import path from 'node:path';
import { defineConfig } from 'vitest/config';

const projectRoot = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
    // Tests must never reach the network or a database. Anything that needs
    // Postgres/Redis/S3 belongs in an integration suite that is not run here.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});

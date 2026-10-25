import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['src/renderer/src/test-setup.ts'],
          include: ['src/renderer/src/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/{main,preload,shared}/**/*.test.ts'],
          exclude: ['**/*.db.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['src/**/*.db.test.ts'],
          // these start a container; the first run also pulls the image
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});

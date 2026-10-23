import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // DB tests start a container; the first run also pulls the image
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // two apps and a Postgres container run at once, so the layout and the first paint can be slow
  expect: { timeout: 10_000 },
});

import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// the installed program (`/opt/pgsketch/pgsketch`) or an unpacked build (`dist/linux-unpacked/pgsketch`)
const executable = process.env.PGSKETCH_EXECUTABLE;
test.skip(!executable, 'PGSKETCH_EXECUTABLE is not set to a packaged build');

test('the packaged app opens the Connect screen and quits cleanly', async () => {
  const { app, window } = await launchApp(undefined, executable);
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  await expect(
    window.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeVisible();

  const child = app.process();
  await app.close();
  expect(child.exitCode).toBe(0);
});

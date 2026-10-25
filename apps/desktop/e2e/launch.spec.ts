import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('launches the app and reads the window title', async () => {
  const { app, window } = await launchApp();
  await expect(window).toHaveTitle('pgsketch');
  await app.close();
});

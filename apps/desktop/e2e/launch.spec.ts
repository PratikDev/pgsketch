import { _electron as electron, expect, test } from '@playwright/test';

test('launches the app and reads the window title', async () => {
  const app = await electron.launch({ args: ['.'] });
  const window = await app.firstWindow();
  await expect(window).toHaveTitle('pgsketch');
  await app.close();
});

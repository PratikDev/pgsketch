import { expect, test } from '@playwright/test';
import { launchApp, spawnApp } from './app';

test('two instances with different data folders run side by side', async () => {
  const a = await launchApp();
  const b = await launchApp();
  expect(a.dataDir).not.toBe(b.dataDir);
  await expect(a.window).toHaveTitle('pgsketch');
  await expect(b.window).toHaveTitle('pgsketch');
  await a.app.close();
  await b.app.close();
});

test('a second launch with the same data folder hands over to the first and exits', async () => {
  const first = await launchApp();
  // count the hand-overs the first instance receives
  await first.app.evaluate(({ app }) => {
    app.on('second-instance', () => {
      process.env.SECOND_LAUNCHES = String(
        Number(process.env.SECOND_LAUNCHES ?? 0) + 1,
      );
    });
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawnApp(first.dataDir);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the second launch did not exit'));
    }, 20_000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal !== null)
        reject(new Error(`the second launch was killed by ${signal}`));
      else resolve(code);
    });
  });

  expect(exitCode).toBe(0);
  await expect
    .poll(() => first.app.evaluate(() => process.env.SECOND_LAUNCHES))
    .toBe('1');
  // still one window, and the first instance is still running
  expect(
    await first.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
  await expect(first.window).toHaveTitle('pgsketch');
  await first.app.close();
});

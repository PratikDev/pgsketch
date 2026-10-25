import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { launchApp, processEnv } from './app';

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
  const electronPath = await first.app.evaluate(() => process.execPath);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(electronPath, ['.'], {
      env: { ...processEnv(), PGSKETCH_DATA_DIR: first.dataDir },
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the second launch did not exit'));
    }, 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
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

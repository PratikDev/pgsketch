import { _electron as electron, expect, test } from '@playwright/test';

test('the renderer reaches main only through the typed bridge', async () => {
  const app = await electron.launch({ args: ['.'] });
  const window = await app.firstWindow();
  const run = <T>(expression: string) => window.evaluate<T>(expression);

  expect(
    await run<{ message: string }>(
      `window.api.invoke('app.ping', { message: 'hi' })`,
    ),
  ).toEqual({ message: 'hi' });

  // main validates what it receives, so a payload that breaks the types still meets the schema
  expect(
    await run<string>(
      `window.api.invoke('app.ping', { message: 1 }).then(() => 'resolved', (e) => e.message)`,
    ),
  ).toContain('Invalid input for "app.ping"');
  expect(
    await run<string>(
      `window.api.invoke('shell.openExternal', 'file:///').then(() => 'resolved', (e) => e.message)`,
    ),
  ).toContain('Unknown channel');

  // nothing but the bridge: no ipcRenderer, no node, and the sandbox is on
  expect(await run<string[]>(`Object.keys(window.api).sort()`)).toEqual([
    'invoke',
    'on',
  ]);
  expect(await run<string>(`typeof window.electron`)).toBe('undefined');
  expect(await run<string>(`typeof window.require`)).toBe('undefined');
  expect(await run<string>(`typeof process`)).toBe('undefined');
  await app.close();
});

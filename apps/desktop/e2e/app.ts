import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, chromium, expect } from '@playwright/test';

/** The environment of this process, as the strings Electron's launcher wants. */
export const processEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/**
 * Starts the built app in a data folder of its own, so that tests running side by side (and the
 * developer's own copy of the app) never share a database, a log or the single-instance lock.
 */
export async function launchApp(dataDir?: string) {
  const folder = dataDir ?? mkdtempSync(join(tmpdir(), 'pgsketch-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...processEnv(), PGSKETCH_DATA_DIR: folder },
  });
  const window = await app.firstWindow();
  return { app, window, dataDir: folder };
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });

/**
 * Starts the built app on its own and attaches to it over the DevTools protocol. Playwright's own
 * launcher starts Electron with `--password-store=basic`, which leaves the app without a system
 * keyring, so this is how a test sees the keyring-backed parts of the app.
 */
export async function launchWithKeyring() {
  const dataDir = mkdtempSync(join(tmpdir(), 'pgsketch-e2e-'));
  const port = await freePort();
  const electronPath = join(
    process.cwd(),
    'node_modules',
    'electron',
    'dist',
    'electron',
  );
  const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
    env: { ...processEnv(), PGSKETCH_DATA_DIR: dataDir },
    stdio: 'ignore',
  });
  await expect
    .poll(
      () =>
        fetch(`http://127.0.0.1:${port}/json/version`).then(
          (r) => r.ok,
          () => false,
        ),
      {
        timeout: 20_000,
      },
    )
    .toBe(true);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('The app has no browser context');
  await expect
    .poll(() => context.pages().length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const window = context.pages()[0];
  if (!window) throw new Error('The app has no window');
  return {
    window,
    dataDir,
    close: async () => {
      await browser.close();
      child.kill();
    },
  };
}

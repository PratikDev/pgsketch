import { expect, test } from '@playwright/test';
import type { TestServer } from '../test/postgres';
import { launchApp } from './app';
import { connectThroughForm } from './form';
import { E2E_PASSWORD, E2E_USER, startE2eServer } from './server';

let server: TestServer;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startE2eServer();
});

test.afterAll(async () => {
  await server?.stop();
});

test('a wrong password shows the message, and the right one opens the Editor screen', async () => {
  const { app, window } = await launchApp();
  await expect(
    window.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeVisible();

  await connectThroughForm(window, server, 'not-the-password');
  await expect(
    window.getByText(`Password authentication failed for user "${E2E_USER}"`),
  ).toBeVisible();
  await expect(
    window.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeVisible();

  await connectThroughForm(window, server, E2E_PASSWORD);
  await expect(window.getByRole('heading', { name: 'Editor' })).toBeVisible();
  await expect(
    window.getByText(server.database, { exact: true }),
  ).toBeVisible();

  await window.getByRole('button', { name: 'Disconnect' }).click();
  await expect(
    window.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeVisible();
  await app.close();
});

test('the SSL mode follows the host until one is picked', async () => {
  const { app, window } = await launchApp();
  const ssl = window.getByRole('combobox', { name: 'SSL mode' });
  await expect(ssl).toHaveText('disable');
  await window.getByLabel('Host').fill('db.example.com');
  await expect(ssl).toHaveText('require');
  await app.close();
});

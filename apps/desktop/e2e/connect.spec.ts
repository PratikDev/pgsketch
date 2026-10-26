import { expect, test, type Page } from '@playwright/test';
import type { TestServer } from '../test/postgres';
import { launchApp } from './app';
import { E2E_PASSWORD, E2E_USER, startE2eServer } from './server';

let server: TestServer;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startE2eServer();
});

test.afterAll(async () => {
  await server?.stop();
});

async function fillForm(window: Page, password: string): Promise<void> {
  await window.getByLabel('Host').fill(server.host);
  await window.getByLabel('Port').fill(String(server.port));
  await window.getByLabel('User').fill(E2E_USER);
  await window.getByLabel('Password').fill(password);
  await window.getByLabel('Database').fill(server.database);
  await window.getByRole('button', { name: 'Connect' }).click();
}

test('a wrong password shows the message, and the right one opens the Editor screen', async () => {
  const { app, window } = await launchApp();
  await expect(
    window.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeVisible();

  await fillForm(window, 'not-the-password');
  await expect(
    window.getByText(`Password authentication failed for user "${E2E_USER}"`),
  ).toBeVisible();
  await expect(
    window.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeVisible();

  await fillForm(window, E2E_PASSWORD);
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

import type { Page } from '@playwright/test';
import type { TestServer } from '../test/postgres';
import { E2E_USER } from './server';

/** Fills the Connect form for the e2e server and presses Connect. */
export async function connectThroughForm(
  window: Page,
  server: TestServer,
  password: string,
): Promise<void> {
  await window.getByLabel('Host').fill(server.host);
  await window.getByLabel('Port').fill(String(server.port));
  await window.getByLabel('User').fill(E2E_USER);
  await window.getByLabel('Password', { exact: true }).fill(password);
  await window.getByLabel('Database').fill(server.database);
  await window.getByRole('button', { name: 'Connect' }).click();
}

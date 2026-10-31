import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';
import { rowOf, showTable } from './canvas';
import { connectThroughForm } from './form';
import { E2E_PASSWORD, E2E_USER, startE2eServer } from './server';

// the same fixture every introspection test in core starts from
const FIXTURE = join(
  process.cwd(),
  '../../packages/core/test/fixtures/basic.sql',
);
const SHOTS = join(process.cwd(), '../../docs/screenshots');

// not a test: it takes the pictures in the README, so it runs only when asked for
test.skip(
  !process.env.PGSKETCH_SCREENSHOTS,
  'set PGSKETCH_SCREENSHOTS=1 to take the screenshots of the README',
);

test('the screenshots of the README', async () => {
  test.setTimeout(180_000);
  const server = await startE2eServer();
  await server.admin.query(readFileSync(FIXTURE, 'utf8'));
  // Validate alters the table, so the app's user owns it
  await server.admin.query(
    `GRANT USAGE ON SCHEMA billing TO ${E2E_USER}; ALTER TABLE billing.line_items OWNER TO ${E2E_USER}`,
  );
  const { app, window } = await launchApp();
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 800),
    );
    await expect(
      window.getByRole('heading', { name: 'Connect to Postgres' }),
    ).toBeVisible();
    await window.screenshot({ path: join(SHOTS, 'connect.png') });

    await connectThroughForm(window, server, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await window.screenshot({ path: join(SHOTS, 'canvas.png') });

    // two edits: a column renamed, and a new one after it
    await showTable(window, 'billing.line_items');
    await rowOf(window, 'billing.line_items', 'label')
      .getByRole('button', { name: 'label', exact: true })
      .click();
    await window.keyboard.type('title');
    await window.keyboard.press('Enter');
    await window.keyboard.type('note');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Escape');
    await expect(window.getByText('2 changes', { exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Generate SQL' }).click();
    const panel = window.getByRole('region', { name: 'SQL' });
    await expect(panel.locator('.cm-content')).toContainText('"title"');
    await panel.getByRole('button', { name: 'Validate' }).click();
    await expect(panel.getByText(/statements? passed/)).toBeVisible();
    await window.screenshot({ path: join(SHOTS, 'sql.png') });
  } finally {
    await app.close();
    await server.stop();
  }
});

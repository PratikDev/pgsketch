import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TestServer } from '../test/postgres';
import { launchApp } from './app';
import { emptyPoint, rowOf, showTable, toastWith } from './canvas';
import { connectThroughForm } from './form';
import { recordGif } from './recorder';
import { E2E_PASSWORD, E2E_USER, startE2eServer } from './server';

// the same fixture every introspection test in core starts from
const FIXTURE = join(
  process.cwd(),
  '../../packages/core/test/fixtures/basic.sql',
);
const MEDIA = join(process.cwd(), '../../docs/media');

// not tests: they record the animations of the README, so they run only when asked for
test.skip(
  !process.env.PGSKETCH_RECORDINGS,
  'set PGSKETCH_RECORDINGS=1 (and have ffmpeg) to record the animations of the README',
);

let server: TestServer;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startE2eServer();
  await server.admin.query(readFileSync(FIXTURE, 'utf8'));
  // Validate alters the table, so the app's user owns what the recordings touch
  await server.admin.query(
    `GRANT USAGE ON SCHEMA billing, public TO ${E2E_USER};
     GRANT CREATE ON SCHEMA public TO ${E2E_USER};
     ALTER TABLE billing.line_items OWNER TO ${E2E_USER}`,
  );
});

test.afterAll(async () => {
  await server?.stop();
});

/** The app on the fixture, in a window of the size the pictures are. */
async function openApp() {
  const { app, window } = await launchApp();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    // 1200 x 667 of the app's own pixels, drawn 1.2 times larger so the text is readable when shrunk
    win?.setContentSize(1440, 800);
    win?.webContents.setZoomFactor(1.2);
  });
  await connectThroughForm(window, server, E2E_PASSWORD);
  await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
  return { app, window };
}

/** A row by its place, which a rename does not change. */
const rowN = (window: Page, table: string, n: number) =>
  window.getByRole('region', { name: table }).getByRole('listitem').nth(n);

test('edit: a rename, a new type and NOT NULL, in place', async () => {
  test.setTimeout(120_000);
  const { app, window } = await openApp();
  const table = 'billing.line_items';
  await showTable(window, table);
  await recordGif(window, join(MEDIA, 'edit.gif'), async (pencil) => {
    const label = rowN(window, table, 3); // the fourth row, `label`
    await pencil.tap(label.getByRole('button', { name: 'label', exact: true }));
    await pencil.type('title');
    await window.keyboard.press('Tab'); // commits it
    await pencil.tap(
      label.getByRole('button', {
        name: 'Column type',
      }),
    );
    await pencil.tap(window.getByRole('option', { name: 'text', exact: true }));
    await pencil.tap(label.getByRole('button', { name: /^NN/ }));
    await pencil.rest(900);
  });
  await app.close();
});

test('foreign key: a new table, a column, and a line dragged to users', async () => {
  test.setTimeout(120_000);
  const { app, window } = await openApp();
  await showTable(window, 'public.users');
  const spot = await emptyPoint(window);
  await recordGif(window, join(MEDIA, 'foreign-key.gif'), async (pencil) => {
    await pencil.glide(spot, 500);
    await window.mouse.dblclick(spot.x, spot.y);
    await expect(
      window.getByRole('textbox', { name: 'Table name' }),
    ).toBeFocused();
    await pencil.type('payments');
    await window.keyboard.press('Enter');
    const payments = window.getByRole('region', { name: 'public.payments' });
    await pencil.glide(await pencil.centre(payments.locator('header')), 450);
    await pencil.tap(window.getByRole('button', { name: 'Add column' }));
    await pencil.type('user_id');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Escape');
    await pencil.tap(
      rowN(window, 'public.payments', 1).getByRole('button', {
        name: 'Column type',
      }),
    );
    await pencil.tap(
      window.getByRole('option', { name: 'bigint', exact: true }),
    );
    await pencil.drag(
      rowN(window, 'public.payments', 1),
      rowOf(window, 'public.users', 'id'),
    );
    await expect(window.locator('.react-flow__edge')).toHaveCount(4);
    await pencil.rest(900);
  });
  await app.close();
});

test('removed: a column struck through, then restored', async () => {
  test.setTimeout(120_000);
  const { app, window } = await openApp();
  const table = 'billing.line_items';
  await showTable(window, table);
  const label = rowN(window, table, 3);
  await recordGif(window, join(MEDIA, 'removed.gif'), async (pencil) => {
    await pencil.glide(await pencil.centre(label), 450);
    await pencil.tap(label.getByRole('button', { name: 'Column actions' }));
    await pencil.tap(window.getByRole('menuitem', { name: 'Delete column' }));
    await expect(label).toHaveAttribute('data-status', 'removed');
    await pencil.rest(1100);
    await pencil.tap(label.getByRole('button', { name: 'Column actions' }));
    await pencil.tap(window.getByRole('menuitem', { name: 'Restore column' }));
    await pencil.rest(800);
  });
  await app.close();
});

test('applied: the SQL is run from outside and pgsketch takes it', async () => {
  test.setTimeout(120_000);
  const { app, window } = await openApp();
  await showTable(window, 'public.users');
  const spot = await emptyPoint(window);
  await recordGif(window, join(MEDIA, 'applied.gif'), async (pencil) => {
    await pencil.glide(spot, 500);
    await window.mouse.dblclick(spot.x, spot.y);
    await pencil.type('tags');
    await window.keyboard.press('Enter');
    await pencil.tap(window.getByRole('button', { name: 'Generate SQL' }));
    const panel = window.getByRole('region', { name: 'SQL' });
    await expect(panel.locator('.cm-content')).toContainText('CREATE TABLE');
    await pencil.rest(1600);
    // someone runs it: the panel's own text, in another session
    const sql = await panel.locator('.cm-content').innerText();
    await server.admin.query(sql);
    await expect(toastWith(window, 'Changes applied')).toBeVisible({
      timeout: 15_000,
    });
    await pencil.rest(1800);
  });
  await app.close();
});

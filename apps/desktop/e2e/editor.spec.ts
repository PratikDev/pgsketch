import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TestServer } from '../test/postgres';
import { launchApp } from './app';
import { connectThroughForm } from './form';
import { E2E_PASSWORD, startE2eServer } from './server';

// the same fixture every introspection test in core starts from
const FIXTURE = join(
  process.cwd(),
  '../../packages/core/test/fixtures/basic.sql',
);

let server: TestServer;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startE2eServer();
  await server.admin.query(readFileSync(FIXTURE, 'utf8'));
});

test.afterAll(async () => {
  await server?.stop();
});

test('every table of the fixture appears on the canvas as a node, with its columns', async () => {
  const { app, window } = await launchApp();
  await connectThroughForm(window, server, E2E_PASSWORD);

  const nodes = window.locator('.react-flow__node');
  await expect(nodes).toHaveCount(3);
  for (const name of ['public.users', 'billing.invoices', 'billing.line_items'])
    await expect(window.getByRole('region', { name })).toBeVisible();

  const users = window.getByRole('region', { name: 'public.users' });
  await expect(users.getByRole('listitem')).toHaveCount(5);
  await expect(users.getByText('PK')).toBeVisible();
  await expect(users.getByText('→ users.id')).toBeVisible(); // invited_by points back at the table
  await expect(users.getByText("= 'active'::public.user_status")).toBeVisible();

  // a foreign key shows the schema only when it points at another one
  const items = window.getByRole('region', { name: 'billing.line_items' });
  await expect(items.getByText('→ invoices.id')).toBeVisible();
  const invoices = window.getByRole('region', { name: 'billing.invoices' });
  await expect(invoices.getByText('→ public.users.id')).toBeVisible();
  await app.close();
});

test("foreign keys are lines with crow's feet, a self-reference is a loop, and the layout keeps the tables apart", async () => {
  const { app, window } = await launchApp();
  await connectThroughForm(window, server, E2E_PASSWORD);
  // the layout runs in a worker; if the page's policy stopped it, this would say "failed"
  await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);

  // one line for each foreign key: invited_by, user_id, and the composite key of line_items
  const edges = window.locator('.react-flow__edge');
  await expect(edges).toHaveCount(3);
  const path = edges.locator('path.react-flow__edge-path');
  for (const one of await path.all()) {
    await expect(one).toHaveAttribute(
      'marker-start',
      'url(#pgsketch-crow-foot)',
    );
    await expect(one).toHaveAttribute('marker-end', 'url(#pgsketch-one)');
  }

  // the self-reference leaves the right side of its table and comes back to it: a loop
  const loop = window.locator(
    '[data-self-reference="true"] path.react-flow__edge-path',
  );
  await expect(loop).toHaveCount(1);
  await expect(window.locator('[data-self-reference="false"]')).toHaveCount(2);
  const users = await window
    .getByRole('region', { name: 'public.users' })
    .boundingBox();
  const loopBox = await loop.boundingBox();
  const right = users!.x + users!.width;
  expect(loopBox!.x).toBeGreaterThan(right - 12);
  expect(loopBox!.x + loopBox!.width).toBeGreaterThan(right + 12);

  // no two tables overlap, and a table sits to the left of the one its foreign key points at
  const boxes = Object.fromEntries(
    await Promise.all(
      ['public.users', 'billing.invoices', 'billing.line_items'].map(
        async (name) =>
          [
            name,
            (await window.getByRole('region', { name }).boundingBox())!,
          ] as const,
      ),
    ),
  );
  const names = Object.keys(boxes);
  for (const a of names)
    for (const b of names.filter((n) => n > a)) {
      const [p, q] = [boxes[a]!, boxes[b]!];
      const apart =
        p.x + p.width <= q.x ||
        q.x + q.width <= p.x ||
        p.y + p.height <= q.y ||
        q.y + q.height <= p.y;
      expect(apart, `${a} and ${b}`).toBe(true);
    }
  expect(boxes['billing.line_items']!.x).toBeLessThan(
    boxes['billing.invoices']!.x,
  );
  expect(boxes['billing.invoices']!.x).toBeLessThan(boxes['public.users']!.x);
  await app.close();
});

/** The scale React Flow draws the canvas at, from the transform on its viewport. */
const zoomOf = async (window: Page) =>
  Number(
    /scale\(([\d.]+)\)/.exec(
      (await window.locator('.react-flow__viewport').getAttribute('style')) ??
        '',
    )?.[1],
  );

/** Zooms with the canvas controls until the tables are (or are not) compact; the fit on load can land either side of 70%. */
async function zoomUntil(window: Page, compact: boolean) {
  const button = window.getByRole('button', {
    name: compact ? 'zoom out' : 'zoom in',
  });
  while ((await zoomOf(window)) < 0.7 !== compact) {
    await button.click();
    await window.waitForTimeout(350);
  }
}

test('zooming out below 70% turns tables into compact nodes, and clicking one zooms back to it', async () => {
  const { app, window } = await launchApp();
  await connectThroughForm(window, server, E2E_PASSWORD);
  await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
  await zoomUntil(window, false);
  await expect(window.locator('.react-flow__node-table')).toHaveCount(3);
  await expect(window.locator('.react-flow__node-compact')).toHaveCount(0);

  await zoomUntil(window, true);
  await expect(window.locator('.react-flow__node-compact')).toHaveCount(3);
  await expect(window.locator('.react-flow__node-table')).toHaveCount(0);
  const users = window.getByRole('region', { name: 'public.users' });
  await expect(users).toContainText('5 columns');
  await expect(users.getByRole('listitem')).toHaveCount(0);
  // the lines are still drawn, to the compact nodes
  await expect(window.locator('.react-flow__edge')).toHaveCount(3);

  await users.click();
  await expect.poll(() => zoomOf(window)).toBeGreaterThanOrEqual(0.7);
  await expect(window.locator('.react-flow__node-table').first()).toBeVisible();
  await expect(
    window.getByRole('region', { name: 'public.users' }).getByRole('listitem'),
  ).toHaveCount(5);
  await app.close();
});

test('a table that was moved is where it was left after the app is restarted', async () => {
  // where the canvas has the node, which unlike its place on screen does not depend on the zoom
  const spot = (window: Page) =>
    window
      .locator('.react-flow__node', {
        has: window.getByRole('region', { name: 'billing.invoices' }),
      })
      .evaluate((node) => node.style.transform);

  const first = await launchApp();
  await connectThroughForm(first.window, server, E2E_PASSWORD);
  await expect(first.window.locator('[data-layout="ready"]')).toHaveCount(1);
  await zoomUntil(first.window, false);
  const before = await spot(first.window);

  // drag it by its header
  const header = first.window
    .getByRole('region', { name: 'billing.invoices' })
    .locator('header');
  const grab = (await header.boundingBox())!;
  const [x, y] = [grab.x + grab.width / 2, grab.y + grab.height / 2];
  await first.window.mouse.move(x, y);
  await first.window.mouse.down();
  await first.window.mouse.move(x - 60, y + 90, { steps: 8 });
  await first.window.mouse.up();
  const moved = await spot(first.window);
  expect(moved).not.toBe(before);

  // saved a moment after the last move
  await first.window.waitForTimeout(1_200);
  await first.app.close();

  const second = await launchApp(first.dataDir);
  await connectThroughForm(second.window, server, E2E_PASSWORD);
  await expect(second.window.locator('[data-layout="ready"]')).toHaveCount(1);
  expect(await spot(second.window)).toBe(moved);
  await second.app.close();
});

test('hiding a schema hides its tables, and a foreign key into it ends in a stub', async () => {
  const { app, window } = await launchApp();
  await connectThroughForm(window, server, E2E_PASSWORD);
  await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
  await expect(window.locator('.react-flow__node')).toHaveCount(3);

  await window.getByRole('button', { name: /^Schemas/ }).click();
  await window.getByRole('menuitemcheckbox', { name: 'public' }).click();
  await window.keyboard.press('Escape');

  // users is gone; invoices stays, and its key to users is a stub
  await expect(
    window.getByRole('region', { name: 'public.users' }),
  ).toHaveCount(0);
  await expect(
    window.getByRole('region', { name: 'billing.invoices' }),
  ).toBeVisible();
  await expect(
    window.getByRole('region', { name: 'billing.line_items' }),
  ).toBeVisible();
  const stub = window.locator('.react-flow__node-stub');
  await expect(stub).toHaveCount(1);
  await expect(stub).toHaveText('→ public.users');
  // the line from line_items to invoices, and the one from invoices to the stub
  await expect(window.locator('.react-flow__edge')).toHaveCount(2);

  await window.getByRole('button', { name: /^Schemas/ }).click();
  await window.getByRole('menuitem', { name: 'Show all' }).click();
  await window.keyboard.press('Escape');
  await expect(window.locator('.react-flow__node-stub')).toHaveCount(0);
  await expect(
    window.getByRole('region', { name: 'public.users' }),
  ).toBeVisible();
  await app.close();
});

test('disconnecting from the Editor returns to the Connect screen', async () => {
  const { app, window } = await launchApp();
  await connectThroughForm(window, server, E2E_PASSWORD);
  await expect(window.locator('.react-flow__node')).toHaveCount(3);
  await window.getByRole('button', { name: 'Disconnect' }).click();
  await expect(
    window.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeVisible();
  await app.close();
});

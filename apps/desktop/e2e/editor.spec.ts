import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
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

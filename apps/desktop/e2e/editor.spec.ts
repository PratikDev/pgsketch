import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
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
  await expect(
    users.getByRole('button', { name: /^PK/, pressed: true }),
  ).toHaveCount(1);
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

/** Where the canvas has a table, which unlike its place on screen does not depend on the zoom. */
const spot = (window: Page, table: string) =>
  window
    .locator('.react-flow__node', {
      has: window.getByRole('region', { name: table }),
    })
    .evaluate((node) => node.style.transform);

/** The row of a column in a table, at a zoom where tables are not compact. */
const rowOf = (window: Page, table: string, column: string) =>
  window
    .getByRole('region', { name: table })
    .getByRole('listitem')
    .filter({ has: window.getByRole('button', { name: column, exact: true }) });

/**
 * Brings a table into view at a readable zoom. Zooming in with the controls goes towards the
 * middle and can push a table off screen, so this fits all the tables in the view first and then
 * clicks the table's compact node, which zooms to exactly that table.
 */
async function showTable(window: Page, table: string) {
  await window.getByRole('button', { name: 'fit view' }).click();
  await window.waitForTimeout(400);
  if ((await zoomOf(window)) < 0.7)
    await window.getByRole('region', { name: table }).click();
  await expect.poll(() => zoomOf(window)).toBeGreaterThanOrEqual(0.7);
  await expect(
    window.getByRole('region', { name: table }).getByRole('listitem').first(),
  ).toBeVisible();
}

async function openEditor(table?: string) {
  const { app, window } = await launchApp();
  await connectThroughForm(window, server, E2E_PASSWORD);
  await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
  if (table) await showTable(window, table);
  return { app, window };
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
  const first = await launchApp();
  await connectThroughForm(first.window, server, E2E_PASSWORD);
  await expect(first.window.locator('[data-layout="ready"]')).toHaveCount(1);
  await zoomUntil(first.window, false);
  const before = await spot(first.window, 'billing.invoices');

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
  const moved = await spot(first.window, 'billing.invoices');
  expect(moved).not.toBe(before);

  // saved a moment after the last move
  await first.window.waitForTimeout(1_200);
  await first.app.close();

  const second = await launchApp(first.dataDir);
  await connectThroughForm(second.window, server, E2E_PASSWORD);
  await expect(second.window.locator('[data-layout="ready"]')).toHaveCount(1);
  expect(await spot(second.window, 'billing.invoices')).toBe(moved);
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

test('renaming a column: it turns amber and the change count goes up', async () => {
  const { app, window } = await openEditor('billing.line_items');
  await expect(window.getByText('0 changes')).toBeVisible();
  await rowOf(window, 'billing.line_items', 'label')
    .getByRole('button', { name: 'label', exact: true })
    .click();
  await window.keyboard.type('title');
  // Tab, not Enter: label is the last column, and Enter there goes on to a new one
  await window.keyboard.press('Tab');

  const row = rowOf(window, 'billing.line_items', 'title');
  await expect(row).toHaveAttribute('data-status', 'modified');
  await expect(row).toHaveAttribute('title', 'Was: name label');
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();
  await app.close();
});

test('Esc cancels a rename, and nothing is changed', async () => {
  const { app, window } = await openEditor('billing.line_items');
  await rowOf(window, 'billing.line_items', 'label')
    .getByRole('button', { name: 'label', exact: true })
    .click();
  await window.keyboard.type('title');
  await window.keyboard.press('Escape');
  await expect(
    rowOf(window, 'billing.line_items', 'label'),
  ).not.toHaveAttribute('data-status');
  await expect(window.getByText('0 changes')).toBeVisible();
  await app.close();
});

test('selecting text in the input does not move the node, and Backspace does not delete it', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = 'billing.line_items';
  const before = await spot(window, table);
  await rowOf(window, table, 'label')
    .getByRole('button', { name: 'label', exact: true })
    .click();
  const input = window.getByRole('textbox', { name: 'Column name' });
  const box = (await input.boundingBox())!;
  // drag across the text, as a person selecting it would
  await window.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + 4, box.y + box.height / 2 + 30, { steps: 6 });
  await window.mouse.up();
  expect(await spot(window, table)).toBe(before);

  // Backspace edits the text, and the table stays
  await window.keyboard.press('Backspace');
  await expect(input).toHaveValue('');
  await expect(window.locator('.react-flow__node')).toHaveCount(3);
  await window.keyboard.press('Escape');

  // and with the table itself selected, neither key removes it
  await window.getByRole('region', { name: table }).locator('header').click();
  await window.keyboard.press('Backspace');
  await window.keyboard.press('Delete');
  await expect(window.locator('.react-flow__node')).toHaveCount(3);
  await app.close();
});

test('the table name is renamed the same way', async () => {
  const { app, window } = await openEditor('billing.line_items');
  await window
    .getByRole('region', { name: 'billing.line_items' })
    .getByRole('button', { name: 'line_items', exact: true })
    .click();
  await window.keyboard.type('order_lines');
  await window.keyboard.press('Enter');
  await expect(
    window.getByRole('region', { name: 'billing.order_lines' }),
  ).toHaveAttribute('data-status', 'modified');
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();
  await app.close();
});

test('NN, PK and UQ switch on click; PK turns NN on and locks it, and identity locks it too', async () => {
  const { app, window } = await openEditor();
  const nn = (row: ReturnType<typeof rowOf>) =>
    row.getByRole('button', { name: /^NN/ });
  const pk = (row: ReturnType<typeof rowOf>) =>
    row.getByRole('button', { name: /^PK/ });

  // NN on a nullable column
  await showTable(window, 'public.users');
  const invitedBy = rowOf(window, 'public.users', 'invited_by');
  await expect(nn(invitedBy)).toHaveAttribute('aria-pressed', 'false');
  await nn(invitedBy).click();
  await expect(nn(invitedBy)).toHaveAttribute('aria-pressed', 'true');
  await expect(invitedBy).toHaveAttribute('data-status', 'modified');
  await expect(invitedBy).toHaveAttribute('title', 'Was: nullable');
  await nn(invitedBy).click();
  await expect(invitedBy).not.toHaveAttribute('data-status');

  // an identity column is NOT NULL for good
  await expect(nn(rowOf(window, 'public.users', 'id'))).toBeDisabled();

  // PK on a nullable column
  await showTable(window, 'billing.line_items');
  const label = rowOf(window, 'billing.line_items', 'label');
  await expect(nn(label)).toBeEnabled();
  await pk(label).click();
  await expect(pk(label)).toHaveAttribute('aria-pressed', 'true');
  await expect(nn(label)).toHaveAttribute('aria-pressed', 'true');
  await expect(nn(label)).toBeDisabled();
  await pk(label).click();
  await expect(nn(label)).toHaveAttribute('aria-pressed', 'true');
  await expect(nn(label)).toBeEnabled();

  // UQ
  const issued = rowOf(window, 'billing.line_items', 'issued');
  const uq = issued.getByRole('button', { name: /^UQ/ });
  await uq.click();
  await expect(uq).toHaveAttribute('aria-pressed', 'true');
  await expect(issued).toHaveAttribute('data-status', 'modified');
  await expect(issued).toHaveAttribute('title', 'Was: not unique');
  await uq.click();
  await expect(issued).not.toHaveAttribute('data-status');

  // the three switches and the chips never squeeze a name out of its row
  const names = window
    .getByRole('region', { name: 'billing.line_items' })
    .locator('li > :first-child');
  for (const name of await names.all())
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
  await app.close();
});

test('three columns are made with the keyboard alone, and one is deleted from its menu', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = window.getByRole('region', { name: 'billing.line_items' });
  await expect(table.getByRole('listitem')).toHaveCount(4);

  // Enter on the last column goes on to a new one with its name ready to type
  await rowOf(window, 'billing.line_items', 'label')
    .getByRole('button', { name: 'label', exact: true })
    .click();
  const name = window.getByRole('textbox', { name: 'Column name' });
  await window.keyboard.press('Enter');
  for (const text of ['first', 'second', 'third']) {
    await expect(name).toBeFocused();
    await window.keyboard.type(text);
    await window.keyboard.press('Enter');
  }
  // the column that Enter made after the third is given up with Esc
  await expect(name).toBeFocused();
  await window.keyboard.press('Escape');

  await expect(table.getByRole('listitem')).toHaveCount(7);
  for (const name of ['first', 'second', 'third'])
    await expect(rowOf(window, 'billing.line_items', name)).toHaveAttribute(
      'data-status',
      'added',
    );
  await expect(table.getByText('new_column')).toHaveCount(0);
  await expect(window.getByText('3 changes', { exact: true })).toBeVisible();

  // Tab goes from a name to the type of the same row
  await rowOf(window, 'billing.line_items', 'first')
    .getByRole('button', { name: 'first', exact: true })
    .click();
  await window.keyboard.press('Tab');
  await expect(
    rowOf(window, 'billing.line_items', 'first').getByRole('button', {
      name: 'Column type',
    }),
  ).toBeFocused();

  // the menu at the end of a row
  const third = rowOf(window, 'billing.line_items', 'third');
  await third.hover();
  await third.getByRole('button', { name: 'Column actions' }).click();
  await window.getByRole('menuitem', { name: 'Delete column' }).click();
  await expect(table.getByRole('listitem')).toHaveCount(6);
  await expect(window.getByText('2 changes', { exact: true })).toBeVisible();

  // a column of the database stays on the canvas struck through, and comes back
  const title = rowOf(window, 'billing.line_items', 'label');
  await title.hover();
  await title.getByRole('button', { name: 'Column actions' }).click();
  await window.getByRole('menuitem', { name: 'Delete column' }).click();
  await expect(
    table.getByRole('listitem').filter({ hasText: 'label' }),
  ).toHaveAttribute('data-status', 'removed');
  await expect(table.getByRole('listitem')).toHaveCount(6);
  await app.close();
});

/** A point on the empty canvas: where the pane, not a table, a line or a control, is under the cursor. */
const emptyPoint = (window: Page) =>
  window.evaluate<{ x: number; y: number }>(`(() => {
    const box = document.querySelector('.react-flow').getBoundingClientRect();
    for (let y = box.top + 30; y < box.bottom - 80; y += 30)
      for (let x = box.left + 30; x < box.right - 340; x += 30)
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'))
          return { x, y };
    throw new Error('no empty canvas');
  })()`);

test('a double-click on the empty canvas makes a table at the cursor with its name ready', async () => {
  const { app, window } = await openEditor();
  await zoomUntil(window, false);
  const at = await emptyPoint(window);
  await window.mouse.dblclick(at.x, at.y);

  const created = window.getByRole('region', { name: 'public.new_table' });
  await expect(created).toBeVisible();
  const box = (await created.boundingBox())!;
  expect(Math.abs(box.x - at.x)).toBeLessThan(3);
  expect(Math.abs(box.y - at.y)).toBeLessThan(3);
  await expect(created).toHaveAttribute('data-status', 'added');
  // it starts with an identity key, and its name is the input with the focus
  await expect(created.getByRole('listitem')).toHaveCount(1);
  const name = window.getByRole('textbox', { name: 'Table name' });
  await expect(name).toBeFocused();
  await window.keyboard.type('tags');
  await window.keyboard.press('Enter');
  await expect(
    window.getByRole('region', { name: 'public.tags' }),
  ).toBeVisible();

  // the toolbar of the table: add a column, then delete the table
  const tags = window.getByRole('region', { name: 'public.tags' });
  await tags.locator('header').click();
  await window.getByRole('button', { name: 'Add column' }).click();
  await expect(tags.getByRole('listitem')).toHaveCount(2);
  await expect(
    window.getByRole('textbox', { name: 'Column name' }),
  ).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(tags.getByRole('listitem')).toHaveCount(1);
  await tags.locator('header').click();
  await window.getByRole('button', { name: 'Delete table' }).click();
  await expect(window.getByRole('region', { name: 'public.tags' })).toHaveCount(
    0,
  );
  await expect(window.locator('.react-flow__node')).toHaveCount(3);

  // a double-click on a table does nothing
  await window
    .getByRole('region', { name: 'billing.invoices' })
    .dblclick({ position: { x: 20, y: 20 } });
  await expect(window.locator('.react-flow__node')).toHaveCount(3);
  await app.close();
});

test('the type picker closes on a click on the empty canvas', async () => {
  const { app, window } = await openEditor('billing.line_items');
  await window
    .getByRole('region', { name: 'billing.line_items' })
    .getByRole('button', { name: 'Column type' })
    .first()
    .click();
  await expect(window.getByPlaceholder('Search types…')).toBeVisible();
  const at = await emptyPoint(window);
  await window.mouse.click(at.x, at.y);
  await expect(window.getByPlaceholder('Search types…')).toHaveCount(0);
  await app.close();
});

test('the toolbar stays while the pointer moves from the table up to it', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = window.getByRole('region', { name: 'billing.line_items' });
  const header = (await table.locator('header').boundingBox())!;
  await window.mouse.move(header.x + 60, header.y + header.height / 2);
  const add = window.getByRole('button', { name: 'Add column' });
  await expect(add).toBeVisible();
  // up through the gap to the toolbar, one pixel at a time, and the toolbar never goes away
  const target = (await add.boundingBox())!;
  const [x, y] = [target.x + target.width / 2, target.y + target.height / 2];
  const startY = header.y + header.height / 2;
  for (let i = 1; i <= 40; i++) {
    await window.mouse.move(
      header.x + 60 + ((x - header.x - 60) * i) / 40,
      startY + ((y - startY) * i) / 40,
    );
    await expect(add).toBeVisible({ timeout: 100 });
  }
  await add.click();
  await expect(table.getByRole('listitem')).toHaveCount(5);
  await app.close();
});

test('a new table moves to a new schema from its schema picker, and a table in the database has none', async () => {
  const { app, window } = await openEditor();
  await zoomUntil(window, false);
  const at = await emptyPoint(window);
  await window.mouse.dblclick(at.x, at.y);
  await expect(
    window.getByRole('textbox', { name: 'Table name' }),
  ).toBeFocused();
  await window.keyboard.type('tags');
  await window.keyboard.press('Enter');

  const tags = window.getByRole('region', { name: 'public.tags' });
  await tags.getByRole('button', { name: 'Schema' }).click();
  await window.getByRole('menuitem', { name: 'New schema…' }).click();
  // the name is typed in the menu's row
  await expect(
    window.getByRole('textbox', { name: 'Schema name' }),
  ).toBeFocused();
  await window.keyboard.type('audit');
  await window.keyboard.press('Enter');
  await window.keyboard.press('Escape');
  await expect(
    window.getByRole('region', { name: 'audit.tags' }),
  ).toHaveAttribute('data-status', 'added');

  // the new schema is one of the schemas now
  await window.getByRole('button', { name: /^Schemas/ }).click();
  await expect(
    window.getByRole('menuitemcheckbox', { name: 'audit' }),
  ).toBeVisible();
  await window.keyboard.press('Escape');

  // a table that is in the database can't move: no picker
  await expect(
    window
      .getByRole('region', { name: 'billing.invoices' })
      .getByRole('button', { name: 'Schema' }),
  ).toHaveCount(0);
  await app.close();
});

test('deleting a referenced table marks the keys into it removed, and restoring it brings them back', async () => {
  const { app, window } = await openEditor('public.users');
  const users = window.getByRole('region', { name: 'public.users' });
  const removedKeys = window.locator(
    '.react-flow__edge g[data-removed="true"]',
  );
  await expect(window.locator('.react-flow__edge')).toHaveCount(3);
  await expect(removedKeys).toHaveCount(0);

  await users.locator('header').click();
  await window.getByRole('button', { name: 'Delete table' }).click();
  await expect(users).toHaveAttribute('data-status', 'removed');
  // its own key to itself, and invoices' key to it; the key between invoices and line_items stays
  await expect(removedKeys).toHaveCount(2);
  await expect(window.locator('.react-flow__edge')).toHaveCount(3);
  await expect(window.getByText('2 changes', { exact: false })).toBeVisible();

  // a click on the table brings it and the keys back
  await users.locator('header').click();
  await expect(users).not.toHaveAttribute('data-status');
  await expect(removedKeys).toHaveCount(0);
  await expect(window.getByText('0 changes', { exact: true })).toBeVisible();

  // and a removed column comes back by a click on its row
  await window.getByRole('button', { name: 'fit view' }).click();
  await showTable(window, 'billing.line_items');
  const row = rowOf(window, 'billing.line_items', 'label');
  await row.hover();
  await row.getByRole('button', { name: 'Column actions' }).click();
  await window.getByRole('menuitem', { name: 'Delete column' }).click();
  const removedRow = window
    .getByRole('region', { name: 'billing.line_items' })
    .getByRole('listitem')
    .filter({ hasText: 'label' });
  await expect(removedRow).toHaveAttribute('data-status', 'removed');
  await removedRow.click();
  await expect(removedRow).not.toHaveAttribute('data-status');
  await app.close();
});

test('a schema the migration creates is renamed and deleted from the pen and the trash can, in both menus', async () => {
  const { app, window } = await openEditor();
  await zoomUntil(window, false);
  const at = await emptyPoint(window);
  await window.mouse.dblclick(at.x, at.y);
  await expect(
    window.getByRole('textbox', { name: 'Table name' }),
  ).toBeFocused();
  await window.keyboard.type('tags');
  await window.keyboard.press('Enter');
  // the table's name changes with its schema, so it is found by its own part
  const tags = window.getByRole('region', { name: /\.tags$/ });

  // make a schema, then give it a name with the pen of the Schemas menu
  await tags.getByRole('button', { name: 'Schema' }).click();
  await window.getByRole('menuitem', { name: 'New schema…' }).click();
  await window.keyboard.press('Escape'); // gives up the name: it stays new_schema
  await expect(
    window.getByRole('region', { name: 'new_schema.tags' }),
  ).toBeVisible();
  await window.getByRole('button', { name: /^Schemas/ }).click();
  const rowOf = (name: string) =>
    window.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) });
  // the schemas in the database have neither icon
  await expect(rowOf('billing').getByRole('button')).toHaveCount(0);
  await expect(rowOf('public').getByRole('button')).toHaveCount(0);
  await window
    .getByRole('button', { name: 'Rename schema new_schema' })
    .click();
  await expect(
    window.getByRole('textbox', { name: 'Schema name' }),
  ).toBeFocused();
  await window.keyboard.type('audit');
  await window.keyboard.press('Enter');
  // (the page is hidden to assistive technology while a menu is open)
  await expect(
    window.getByRole('region', { name: 'audit.tags', includeHidden: true }),
  ).toBeVisible();
  // clicking the pen did not tick or untick the row
  await expect(rowOf('audit')).toHaveAttribute('aria-checked', 'true');
  await window.keyboard.press('Escape');

  // a schema with a table in it can't be deleted; the reason is shown
  await window.getByRole('button', { name: /^Schemas/ }).click();
  await window.getByRole('button', { name: 'Delete schema audit' }).click();
  await expect(
    window.getByText(/Can't delete schema "audit": table "tags" is in it/),
  ).toBeVisible();
  await window.keyboard.press('Escape');

  // move the table out, and the empty schema can go
  await tags.getByRole('button', { name: 'Schema' }).click();
  await window.getByRole('menuitemradio', { name: /^public/ }).click();
  await window.keyboard.press('Escape');
  await expect(
    window.getByRole('region', { name: 'public.tags' }),
  ).toBeVisible();
  await tags.getByRole('button', { name: 'Schema' }).click();
  await window.getByRole('button', { name: 'Delete schema audit' }).click();
  await expect(
    window.getByRole('menuitemradio', { name: /^audit/ }),
  ).toHaveCount(0);
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: /^Schemas/ }).click();
  await expect(
    window.getByRole('menuitemcheckbox', { name: /^audit/ }),
  ).toHaveCount(0);
  await app.close();
});

test('what the editor refuses is said in a toast: a type an identity column cannot have', async () => {
  const { app, window } = await openEditor('public.users');
  const id = rowOf(window, 'public.users', 'id');
  await id.getByRole('button', { name: 'Column type' }).click();
  await window.getByRole('option', { name: 'text', exact: true }).click();
  const toast = window.locator('[data-sonner-toast]');
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('identity column');
  // the column keeps its type, and the picker is still open for another try
  await expect(window.getByPlaceholder('Search types…')).toBeVisible();
  await expect(id.getByRole('button', { name: 'Column type' })).toHaveText(
    'bigint',
  );
  // the same refusal again does not pile up a second toast
  await window.getByRole('option', { name: 'text', exact: true }).click();
  await expect(toast).toHaveCount(1);
  await app.close();
});

test('a default is chosen from the presets of its type, and an identity column has no chip', async () => {
  const { app, window } = await openEditor('public.users');
  const row = rowOf(window, 'public.users', 'created_at'); // timestamptz DEFAULT now()
  await expect(
    row.getByRole('button', { name: /^Default: now\(\)/ }),
  ).toHaveText('= now()');

  // take it away, and the row is changed
  await row.getByRole('button', { name: /^Default: now\(\)/ }).click();
  await window.getByRole('button', { name: 'Remove default' }).click();
  await expect(row).toHaveAttribute('data-status', 'modified');
  await expect(row.getByRole('button', { name: /^Default/ })).toHaveCount(0);

  // put it back with the preset: the same SQL as the database has, so nothing is changed
  await row.hover();
  await row.getByRole('button', { name: 'Add a default' }).click();
  await window.getByRole('button', { name: 'now()' }).click();
  await expect(
    row.getByRole('button', { name: /^Default: now\(\)/ }),
  ).toHaveText('= now()');
  await expect(row).not.toHaveAttribute('data-status');
  await expect(window.getByText('0 changes', { exact: true })).toBeVisible();

  // an identity column has no default, and can't be given one
  const id = rowOf(window, 'public.users', 'id');
  await id.hover();
  await expect(id.getByRole('button', { name: /default/i })).toHaveCount(0);

  // a constant is quoted, and Postgres says how it reads it
  const status = rowOf(window, 'public.users', 'status');
  await status.getByRole('button', { name: /^Default/ }).click();
  await window.getByRole('tab', { name: 'Constant' }).click();
  await window.getByRole('textbox', { name: 'Constant' }).fill('banned');
  await window.getByRole('button', { name: 'Set default' }).click();
  await expect(status.getByRole('button', { name: /^Default/ })).toHaveText(
    "= 'banned'::public.user_status",
  );
  await expect(status).toHaveAttribute('data-status', 'modified');

  // an expression that Postgres rejects is said so in the popover, and nothing is set
  await status.getByRole('button', { name: /^Default/ }).click();
  await window.getByRole('tab', { name: 'Expression' }).click();
  await window.getByRole('textbox', { name: 'Expression' }).fill('nonsense(');
  await expect(window.getByRole('alert')).toContainText('syntax error', {
    timeout: 5000,
  });
  await expect(
    window.getByRole('button', { name: 'Set default' }),
  ).toBeDisabled();
  await app.close();
});

/** Drags from one row to another, as a pointer does: from the edge of the first to the edge of the second. */
async function dragBetweenRows(window: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await window.mouse.move(a.x, a.y + a.height / 2);
  await window.mouse.down();
  await window.mouse.move(b.x, b.y + b.height / 2, { steps: 12 });
  await window.mouse.up();
}

/** A point on a line, found on the line itself: the middle of its path, in screen coordinates. */
const pointOnEdge = (window: Page, edge: string) =>
  window.evaluate<{ x: number; y: number }>(`(() => {
    const path = document.querySelector(${JSON.stringify(edge)}).querySelector('path.react-flow__edge-path');
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return { x: point.x * m.a + m.e, y: point.y * m.d + m.f };
  })()`);

test('dragging from one row to another makes a foreign key, to its own table too; what cannot be one is refused', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = 'billing.line_items';
  const edges = window.locator('.react-flow__edge');
  await expect(edges).toHaveCount(3);

  // invoice_id and id are both integers, and id is the key of its table: a key to itself
  const rows = window
    .getByRole('region', { name: table })
    .getByRole('listitem');
  const idRow = rows.first(); // a read-only column: its name is not a button
  const invoiceId = rowOf(window, table, 'invoice_id');
  await dragBetweenRows(window, invoiceId, idRow);
  await expect(edges).toHaveCount(4);
  await expect(
    window.locator('.react-flow__edge g[data-self-reference="true"]'),
  ).toHaveCount(2);
  await expect(
    invoiceId.getByTitle('Foreign key to line_items.id'),
  ).toBeVisible();
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();

  // a varchar can't point at an integer: nothing is made, and the reason is a toast
  await dragBetweenRows(window, rowOf(window, table, 'label'), idRow);
  await expect(window.locator('[data-sonner-toast]')).toContainText(
    'types are incompatible',
  );
  await expect(edges).toHaveCount(4);
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();
  await app.close();
});

test('dragging from a row of one table to a key of another makes a foreign key between them', async () => {
  const { app, window } = await openEditor();
  // the tables as they are laid out, at a zoom where they are full nodes
  await window.getByRole('button', { name: 'fit view' }).click();
  await window.waitForTimeout(400);
  await window.getByRole('button', { name: 'zoom in' }).click();
  await expect.poll(() => zoomOf(window)).toBeGreaterThanOrEqual(0.7);
  const edges = window.locator('.react-flow__edge');
  await expect(edges).toHaveCount(3);

  const userId = rowOf(window, 'billing.invoices', 'user_id');
  await dragBetweenRows(window, userId, rowOf(window, 'public.users', 'id'));
  await expect(edges).toHaveCount(4);
  await expect(userId.getByTitle('Foreign key to public.users.id')).toHaveCount(
    2,
  );
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();
  await app.close();
});

test('a click on a foreign key line opens its popover: changing ON DELETE drops the key and adds it again', async () => {
  const { app, window } = await openEditor();
  const at = await pointOnEdge(
    window,
    '.react-flow__edge:has(g[data-self-reference="false"])',
  );
  await window.mouse.click(at.x, at.y);
  await expect(window.getByText(/→ users|→ invoices/).first()).toBeVisible();
  // (the fixture's key is ON DELETE CASCADE already)
  await window.getByRole('combobox', { name: 'On delete' }).click();
  await window.getByRole('option', { name: 'restrict' }).click();
  // a key that is in the database is changed by dropping it and adding it back
  await expect(window.getByText('2 changes', { exact: true })).toBeVisible();

  // removing it from the popover marks it removed, and the popover then offers to restore it
  await window.getByRole('button', { name: 'Remove foreign key' }).click();
  await expect(
    window.locator('.react-flow__edge g[data-removed="true"]'),
  ).toHaveCount(1);
  const where = await pointOnEdge(
    window,
    '.react-flow__edge:has(g[data-removed="true"])',
  );
  await window.mouse.click(where.x, where.y);
  await window.getByRole('button', { name: 'Restore foreign key' }).click();
  await expect(
    window.locator('.react-flow__edge g[data-removed="true"]'),
  ).toHaveCount(0);
  await app.close();
});

test('an index is added from the toolbar on the columns picked, named from them; a name that clashes shows as an error on the table', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = window.getByRole('region', { name: 'billing.line_items' });
  await expect(
    table.getByRole('button', { name: 'Indexes and checks' }),
  ).toHaveText('0 indexes · 0 checks');

  await table.locator('header').click();
  await window.getByRole('button', { name: 'Add index' }).click();
  const editor = table.getByRole('group', { name: 'New index' });
  await editor.getByRole('button', { name: 'invoice_id' }).click();
  await editor.getByRole('button', { name: 'issued' }).click();
  await editor.getByRole('checkbox', { name: 'Unique' }).click();
  await editor.getByRole('button', { name: 'Add index' }).click();

  const indexes = table
    .getByRole('list', { name: 'Indexes' })
    .getByRole('listitem');
  await expect(indexes).toHaveCount(1);
  await expect(indexes).toContainText('line_items_invoice_id_issued_idx');
  await expect(indexes).toContainText('(invoice_id, issued)');
  await expect(indexes).toContainText('UQ');
  await expect(indexes).toHaveAttribute('data-status', 'added');
  await expect(
    table.getByRole('button', { name: 'Indexes and checks' }),
  ).toHaveText('1 index · 0 checks');
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();

  // an index is named in the same namespace as the tables of its schema
  await indexes
    .getByRole('button', {
      name: 'line_items_invoice_id_issued_idx',
      exact: true,
    })
    .click();
  await window.keyboard.type('invoices');
  await window.keyboard.press('Enter');
  await expect(table).toHaveAttribute('aria-invalid', 'true');
  await expect(indexes).toHaveAttribute('aria-invalid', 'true');
  await expect(table).toHaveAttribute('title', /invoices/);

  // and a name that doesn't clash takes the error away
  await indexes.getByRole('button', { name: 'invoices', exact: true }).click();
  await window.keyboard.type('by_invoice');
  await window.keyboard.press('Enter');
  await expect(table).not.toHaveAttribute('aria-invalid');

  // deleted, a new index is gone; there is nothing to restore
  await indexes
    .getByRole('button', { name: 'Delete index by_invoice' })
    .click();
  await expect(indexes).toHaveCount(0);
  await expect(window.getByText('0 changes', { exact: true })).toBeVisible();
  await app.close();
});

test('a check is added from the footer, read by Postgres, and named from the columns it uses', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = window.getByRole('region', { name: 'billing.line_items' });
  await table.locator('header').click();
  await window.getByRole('button', { name: 'Add check' }).click();
  const editor = table.getByRole('group', { name: 'New check' });
  const input = editor.getByRole('textbox', { name: 'Check expression' });

  // Postgres's own message, under the input
  await input.fill('nonsense(');
  await expect(editor.getByRole('alert')).toContainText('syntax error', {
    timeout: 5000,
  });
  await expect(
    editor.getByRole('button', { name: 'Add check' }),
  ).toBeDisabled();

  // a check on two columns is named for the table alone
  await input.fill('invoice_id > 0 AND issued IS NOT NULL');
  await expect(editor.getByRole('button', { name: 'Add check' })).toBeEnabled({
    timeout: 5000,
  });
  await editor.getByRole('button', { name: 'Add check' }).click();
  const checks = table
    .getByRole('list', { name: 'Constraints' })
    .getByRole('listitem');
  await expect(checks).toHaveCount(1);
  await expect(checks).toContainText('line_items_check');
  await expect(checks).toHaveAttribute('data-status', 'added');
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();

  // on one column, named for it
  await table.locator('header').click();
  await window.getByRole('button', { name: 'Add check' }).click();
  await editor
    .getByRole('textbox', { name: 'Check expression' })
    .fill("label <> ''");
  await expect(editor.getByRole('button', { name: 'Add check' })).toBeEnabled({
    timeout: 5000,
  });
  await editor.getByRole('button', { name: 'Add check' }).click();
  await expect(checks).toHaveCount(2);
  await expect(
    checks.filter({ hasText: 'line_items_label_check' }),
  ).toHaveCount(1);
  await app.close();
});

test('a comment is put on a column and on a table, each a change, and shows on hover', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = window.getByRole('region', { name: 'billing.line_items' });
  const label = rowOf(window, 'billing.line_items', 'label');
  await label.hover();
  await label.getByRole('button', { name: 'Column actions' }).click();
  await window.getByRole('menuitem', { name: 'Comment…' }).click();
  await window
    .getByRole('textbox', { name: 'Comment' })
    .fill('What it says on the invoice');
  await window.getByRole('button', { name: 'Save' }).click();
  await expect(label).toHaveAttribute('data-status', 'modified');
  await expect(label.getByRole('button', { name: 'Comment' })).toHaveAttribute(
    'title',
    'What it says on the invoice',
  );
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();

  await table.locator('header').click();
  await window
    .getByRole('toolbar')
    .getByRole('button', { name: 'Comment' })
    .click();
  await window
    .getByRole('textbox', { name: 'Comment' })
    .fill('Lines of an invoice');
  await window.getByRole('button', { name: 'Save' }).click();
  await expect(window.getByText('2 changes', { exact: true })).toBeVisible();
  await expect(
    table.locator('header').getByRole('button', { name: 'Comment' }),
  ).toHaveAttribute('title', 'Lines of an invoice');

  // saving nothing takes it away again
  await label.getByRole('button', { name: 'Comment' }).click();
  await window.getByRole('textbox', { name: 'Comment' }).fill('');
  await window.getByRole('button', { name: 'Save' }).click();
  await expect(label).not.toHaveAttribute('data-status');
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();
  await app.close();
});

/** A second server, with a table made of what pgsketch can't edit: a generated column and an exclusion constraint. */
async function startServerWithReadOnly(): Promise<TestServer> {
  const extra = await startE2eServer();
  await extra.admin.query(readFileSync(FIXTURE, 'utf8'));
  await extra.admin.query(`CREATE TABLE public.rooms (
    id integer PRIMARY KEY,
    slot integer,
    doubled integer GENERATED ALWAYS AS (slot * 2) STORED,
    EXCLUDE USING btree (slot WITH =)
  )`);
  return extra;
}

test('what pgsketch does not edit is shown with a lock and its reason, with nothing to change it; what depends on a table is counted', async () => {
  test.setTimeout(120_000);
  const extra = await startServerWithReadOnly();
  try {
    const { app, window } = await launchApp();
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);

    // a generated column: a lock, its reason on hover, and none of the controls of a row
    await showTable(window, 'public.rooms');
    const rooms = window.getByRole('region', { name: 'public.rooms' });
    const doubled = rooms.getByRole('listitem').filter({ hasText: 'doubled' });
    await expect(doubled.getByLabel('Read-only')).toBeVisible();
    await expect(doubled).toHaveAttribute('title', /generated column/);
    // its name and type are text, it has no menu, and its switches are off
    await expect(doubled.getByRole('button', { name: 'doubled' })).toHaveCount(
      0,
    );
    await expect(
      doubled.getByRole('button', { name: 'Column type' }),
    ).toHaveCount(0);
    await expect(
      doubled.getByRole('button', { name: 'Column actions' }),
    ).toHaveCount(0);
    for (const button of await doubled.getByRole('button').all())
      await expect(button).toBeDisabled();

    // an exclusion constraint, in the footer
    await rooms.getByRole('button', { name: 'Indexes and checks' }).click();
    const exclusion = rooms
      .getByRole('list', { name: 'Constraints' })
      .getByRole('listitem');
    await expect(exclusion).toHaveCount(1);
    await expect(exclusion.getByLabel('Read-only')).toBeVisible();
    await expect(exclusion).toHaveAttribute('title', /exclusion constraint/);
    await expect(exclusion.getByRole('button')).toHaveCount(0);

    // a partial index, and the view on the table
    await showTable(window, 'billing.invoices');
    const invoices = window.getByRole('region', { name: 'billing.invoices' });
    await expect(invoices.getByText('1 view')).toHaveAttribute(
      'title',
      'view open_invoices',
    );
    await invoices.getByRole('button', { name: 'Indexes and checks' }).click();
    const partial = invoices
      .getByRole('list', { name: 'Indexes' })
      .getByRole('listitem')
      .filter({ hasText: 'invoices_open_idx' });
    await expect(partial.getByLabel('Read-only')).toBeVisible();
    await expect(partial).toHaveAttribute('title', /partial index/);
    await expect(partial.getByRole('button')).toHaveCount(0);
    // the plain index beside it is not locked
    await expect(
      invoices.getByRole('button', {
        name: 'Delete index invoices_user_id_idx',
      }),
    ).toBeVisible();
    await expect(window.getByText('0 changes', { exact: true })).toBeVisible();
    await app.close();
  } finally {
    await extra.stop();
  }
});

test("when the role can't create temporary tables, the first default says so, and no check can be added", async () => {
  test.setTimeout(120_000);
  const extra = await startE2eServer();
  const name = 'notemp';
  try {
    await extra.admin.query(`CREATE DATABASE ${name}`);
    await extra.admin.query(`REVOKE TEMPORARY ON DATABASE ${name} FROM PUBLIC`);
    const inside = new Client({
      host: extra.host,
      port: extra.port,
      user: extra.user,
      password: extra.password,
      database: name,
    });
    await inside.connect();
    await inside.query(
      'CREATE TABLE public.notes (id integer PRIMARY KEY, body text)',
    );
    await inside.end();

    const { app, window } = await launchApp();
    await connectThroughForm(
      window,
      { ...extra, database: name },
      E2E_PASSWORD,
    );
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(window, 'public.notes');
    const notes = window.getByRole('region', { name: 'public.notes' });
    const body = rowOf(window, 'public.notes', 'body');

    // a constant is kept as typed, and the app says expressions can't be read
    await body.hover();
    await body.getByRole('button', { name: 'Add a default' }).click();
    await window.getByRole('tab', { name: 'Constant' }).click();
    await window.getByRole('textbox', { name: 'Constant' }).fill('none');
    await window.getByRole('button', { name: 'Set default' }).click();
    await expect(body.getByRole('button', { name: /^Default/ })).toHaveText(
      "= 'none'",
    );
    await expect(window.locator('[data-sonner-toast]')).toContainText(
      'temporary tables',
    );

    // and a check can't be added: the editor says why
    await notes.locator('header').click();
    await window.getByRole('button', { name: 'Add check' }).click();
    const editor = notes.getByRole('group', { name: 'New check' });
    await expect(editor.getByRole('alert')).toContainText(
      "can't create temporary tables",
    );
    await expect(editor.getByRole('textbox')).toHaveCount(0);
    await expect(
      editor.getByRole('button', { name: 'Add check' }),
    ).toBeDisabled();
    await app.close();
  } finally {
    await extra.stop();
  }
});

test('edits survive a restart of the app', async () => {
  const first = await launchApp();
  await connectThroughForm(first.window, server, E2E_PASSWORD);
  await expect(first.window.locator('[data-layout="ready"]')).toHaveCount(1);
  await showTable(first.window, 'billing.line_items');
  const label = rowOf(first.window, 'billing.line_items', 'label');
  await label.getByRole('button', { name: 'label', exact: true }).click();
  await first.window.keyboard.type('title');
  await first.window.keyboard.press('Tab');
  await expect(
    first.window.getByText('1 change', { exact: true }),
  ).toBeVisible();
  // saved a second after the last edit
  await first.window.waitForTimeout(1_500);
  await first.app.close();

  const second = await launchApp(first.dataDir);
  await connectThroughForm(second.window, server, E2E_PASSWORD);
  await expect(second.window.locator('[data-layout="ready"]')).toHaveCount(1);
  await expect(
    second.window.getByText('1 change', { exact: true }),
  ).toBeVisible();
  await showTable(second.window, 'billing.line_items');
  const title = rowOf(second.window, 'billing.line_items', 'title');
  await expect(title).toHaveAttribute('data-status', 'modified');
  await expect(title).toHaveAttribute('title', 'Was: name label');
  await expect(second.window.locator('[data-sonner-toast]')).toHaveCount(0);

  // undone, nothing is left to restore
  await title.getByRole('button', { name: 'title', exact: true }).click();
  await second.window.keyboard.type('label');
  await second.window.keyboard.press('Tab');
  await expect(
    second.window.getByText('0 changes', { exact: true }),
  ).toBeVisible();
  await second.window.waitForTimeout(1_500);
  await second.app.close();
  const third = await launchApp(first.dataDir);
  await connectThroughForm(third.window, server, E2E_PASSWORD);
  await expect(
    third.window.getByText('0 changes', { exact: true }),
  ).toBeVisible();
  await third.app.close();
});

test('edits made on a database that was dropped and made again while the app was closed are not restored', async () => {
  test.setTimeout(120_000);
  const extra = await startE2eServer();
  try {
    await extra.admin.query(
      'CREATE TABLE public.scratch (id integer PRIMARY KEY, name text)',
    );
    const first = await launchApp();
    await connectThroughForm(first.window, extra, E2E_PASSWORD);
    await expect(first.window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(first.window, 'public.scratch');
    await rowOf(first.window, 'public.scratch', 'name')
      .getByRole('button', { name: 'name', exact: true })
      .click();
    await first.window.keyboard.type('title');
    await first.window.keyboard.press('Tab');
    await expect(
      first.window.getByText('1 change', { exact: true }),
    ).toBeVisible();
    await first.window.waitForTimeout(1_500);
    await first.app.close();

    // as a dump and a restore leave it: the same tables, with other OIDs
    await extra.admin.query('DROP TABLE public.scratch');
    await extra.admin.query(
      'CREATE TABLE public.scratch (id integer PRIMARY KEY, name text)',
    );

    const second = await launchApp(first.dataDir);
    await connectThroughForm(second.window, extra, E2E_PASSWORD);
    await expect(second.window.locator('[data-layout="ready"]')).toHaveCount(1);
    await expect(second.window.locator('[data-sonner-toast]')).toContainText(
      'not restored',
    );
    await expect(
      second.window.getByText('0 changes', { exact: true }),
    ).toBeVisible();
    await showTable(second.window, 'public.scratch');
    await expect(
      rowOf(second.window, 'public.scratch', 'name'),
    ).not.toHaveAttribute('data-status');
    await second.app.close();

    // and it was thrown away, not kept for next time
    const third = await launchApp(first.dataDir);
    await connectThroughForm(third.window, extra, E2E_PASSWORD);
    await expect(third.window.locator('[data-layout="ready"]')).toHaveCount(1);
    await expect(third.window.locator('[data-sonner-toast]')).toHaveCount(0);
    await third.app.close();
  } finally {
    await extra.stop();
  }
});

/** A server of its own with one table to edit, for the tests that change the database from outside. */
async function startScratchServer(columns = 'a text, b text') {
  const extra = await startE2eServer();
  await extra.admin.query(
    `CREATE TABLE public.scratch (id integer PRIMARY KEY, ${columns})`,
  );
  return extra;
}

const changes = (window: Page, n: number) =>
  window.getByText(n === 1 ? '1 change' : `${n} changes`, { exact: true });
/** Drags a toast out to the right, as a swipe would, and lets go. */
async function swipeAway(window: Page, toast: Locator) {
  const box = (await toast.boundingBox())!;
  const y = box.y + box.height / 2;
  await window.mouse.move(box.x + 20, y);
  await window.mouse.down();
  await window.mouse.move(box.x + 400, y, { steps: 12 });
  await window.mouse.up();
}

const toastWith = (window: Page, text: string) =>
  window.locator('[data-sonner-toast]').filter({ hasText: text });

test('the SQL of the edits, run from outside, is taken: changes applied, and a new table keeps its place', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  try {
    const first = await launchApp();
    const { window } = first;
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await zoomUntil(window, false);
    const at = await emptyPoint(window);
    await window.mouse.dblclick(at.x, at.y);
    await expect(
      window.getByRole('textbox', { name: 'Table name' }),
    ).toBeFocused();
    await window.keyboard.type('tags');
    await window.keyboard.press('Enter');
    const tags = window.getByRole('region', { name: 'public.tags' });
    await expect(tags).toHaveAttribute('data-status', 'added');
    const placed = await spot(window, 'public.tags');
    await expect(changes(window, 1)).toBeVisible();

    // what the SQL of this edit would do, done by someone else
    await extra.admin.query(
      'CREATE TABLE public.tags (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY)',
    );
    await expect(toastWith(window, 'Changes applied')).toBeVisible({
      timeout: 10_000,
    });
    await expect(changes(window, 0)).toBeVisible();
    // now a table of the database, with the id the database gave it, in the same place
    await expect(tags).not.toHaveAttribute('data-status');
    expect(await spot(window, 'public.tags')).toBe(placed);
    await expect(
      window.locator('.react-flow__node', { has: tags }),
    ).toHaveAttribute('data-id', /^t:\d+$/);

    // nothing of it is kept: the draft was cleared, and the place is the table's now
    await window.waitForTimeout(1_500);
    await first.app.close();
    const second = await launchApp(first.dataDir);
    await connectThroughForm(second.window, extra, E2E_PASSWORD);
    await expect(second.window.locator('[data-layout="ready"]')).toHaveCount(1);
    await expect(changes(second.window, 0)).toBeVisible();
    await expect(second.window.locator('[data-sonner-toast]')).toHaveCount(0);
    await zoomUntil(second.window, false);
    expect(await spot(second.window, 'public.tags')).toBe(placed);
    await second.app.close();
  } finally {
    await extra.stop();
  }
});

test('half of the SQL run from outside goes stale, and the other half brings it back', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  try {
    const { app, window } = await launchApp();
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(window, 'public.scratch');
    for (const [from, to] of [
      ['a', 'aa'],
      ['b', 'bb'],
    ] as const) {
      await rowOf(window, 'public.scratch', from)
        .getByRole('button', { name: from, exact: true })
        .click();
      await window.keyboard.type(to);
      await window.keyboard.press('Tab');
    }
    await expect(changes(window, 2)).toBeVisible();

    await extra.admin.query('ALTER TABLE public.scratch RENAME COLUMN a TO aa');
    const banner = window.getByText(
      'The database schema changed outside pgsketch.',
    );
    await expect(banner).toBeVisible({ timeout: 10_000 });
    // the edits are all still there
    await expect(changes(window, 2)).toBeVisible();

    await extra.admin.query('ALTER TABLE public.scratch RENAME COLUMN b TO bb');
    await expect(banner).toHaveCount(0, { timeout: 10_000 });
    await expect(toastWith(window, 'Changes applied')).toBeVisible();
    await expect(changes(window, 0)).toBeVisible();
    await app.close();
  } finally {
    await extra.stop();
  }
});

test('an unrelated change from outside shows the banner, and Reload throws the edits away once confirmed', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  try {
    const { app, window } = await launchApp();
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(window, 'public.scratch');
    await rowOf(window, 'public.scratch', 'a')
      .getByRole('button', { name: 'a', exact: true })
      .click();
    await window.keyboard.type('renamed');
    await window.keyboard.press('Tab');
    await expect(changes(window, 1)).toBeVisible();

    await extra.admin.query('ALTER TABLE public.scratch ADD COLUMN c integer');
    await expect(
      window.getByText('The database schema changed outside pgsketch.'),
    ).toBeVisible({ timeout: 10_000 });

    // asked first, and Cancel changes nothing
    await toastWith(window, 'changed outside pgsketch')
      .getByRole('button', { name: 'Reload' })
      .click();
    await expect(
      window.getByRole('heading', {
        name: 'Reload and discard 1 unsaved change?',
      }),
    ).toBeVisible();
    await window.getByRole('button', { name: 'Cancel' }).click();
    await expect(window.getByRole('dialog')).toHaveCount(0);
    await expect(changes(window, 1)).toBeVisible();
    // Cancel leaves the notice where it was, with its button
    await expect(
      window.getByText('The database schema changed outside pgsketch.'),
    ).toBeVisible();

    await toastWith(window, 'changed outside pgsketch')
      .getByRole('button', { name: 'Reload' })
      .click();
    await window.getByRole('button', { name: 'Reload and discard' }).click();
    await expect(
      window.getByText('The database schema changed outside pgsketch.'),
    ).toHaveCount(0);
    await expect(changes(window, 0)).toBeVisible();
    // what the database has now, and none of the edits
    await expect(rowOf(window, 'public.scratch', 'a')).toBeVisible();
    await expect(rowOf(window, 'public.scratch', 'c')).toBeVisible();
    await app.close();
  } finally {
    await extra.stop();
  }
});

test('SQL run while the app was closed is told on the next start as changes applied', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  try {
    const first = await launchApp();
    await connectThroughForm(first.window, extra, E2E_PASSWORD);
    await expect(first.window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(first.window, 'public.scratch');
    await rowOf(first.window, 'public.scratch', 'a')
      .getByRole('button', { name: 'a', exact: true })
      .click();
    await first.window.keyboard.type('renamed');
    await first.window.keyboard.press('Tab');
    await expect(changes(first.window, 1)).toBeVisible();
    await first.window.waitForTimeout(1_500);
    await first.app.close();

    await extra.admin.query(
      'ALTER TABLE public.scratch RENAME COLUMN a TO renamed',
    );

    const second = await launchApp(first.dataDir);
    await connectThroughForm(second.window, extra, E2E_PASSWORD);
    await expect(second.window.locator('[data-layout="ready"]')).toHaveCount(1);
    await expect(toastWith(second.window, 'Changes applied')).toBeVisible();
    await expect(toastWith(second.window, 'not restored')).toHaveCount(0);
    await expect(changes(second.window, 0)).toBeVisible();
    await second.app.close();

    // and not again the time after
    const third = await launchApp(first.dataDir);
    await connectThroughForm(third.window, extra, E2E_PASSWORD);
    await expect(third.window.locator('[data-layout="ready"]')).toHaveCount(1);
    await expect(third.window.locator('[data-sonner-toast]')).toHaveCount(0);
    await third.app.close();
  } finally {
    await extra.stop();
  }
});

test('when the connection is lost the banner says so, keeps the edits, and reconnects', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  try {
    const { app, window } = await launchApp();
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(window, 'public.scratch');
    await rowOf(window, 'public.scratch', 'a')
      .getByRole('button', { name: 'a', exact: true })
      .click();
    await window.keyboard.type('renamed');
    await window.keyboard.press('Tab');
    await expect(changes(window, 1)).toBeVisible();

    // the server ends the sessions of the app
    await extra.admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'pgsketch'",
    );
    const lost = window.getByText(/The connection to the database was lost/);
    await expect(lost).toBeVisible({ timeout: 10_000 });
    const notice = toastWith(window, 'connection to the database was lost');
    await expect(notice).toHaveAttribute('data-dismissible', 'false');
    await swipeAway(window, notice);
    await window.waitForTimeout(600);
    await expect(notice).toBeVisible();
    await expect(window.getByText(/Your edits are kept/)).toBeVisible();
    await expect(changes(window, 1)).toBeVisible();
    // no SQL while the connection is down
    const generate = window.getByRole('button', { name: 'Generate SQL' });
    await expect(generate).toBeDisabled();
    expect(await generate.locator('..').getAttribute('title')).toMatch(
      /connection .* lost/,
    );

    await window.getByRole('button', { name: 'Reconnect' }).click();
    await expect(lost).toHaveCount(0);
    // the edits are as they were, on a database that is as it was
    await expect(changes(window, 1)).toBeVisible();
    await expect(
      window.getByText('The database schema changed outside pgsketch.'),
    ).toHaveCount(0);
    await app.close();
  } finally {
    await extra.stop();
  }
});

test('when the server stops the banner says so, and Reconnect says it cannot while it is down', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  const { app, window } = await launchApp();
  try {
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await extra.stop();
    await expect(
      window.getByText(/The connection to the database was lost/),
    ).toBeVisible({ timeout: 15_000 });
    await window.getByRole('button', { name: 'Reconnect' }).click();
    await expect(window.locator('[data-sonner-toast]')).toHaveCount(1, {
      timeout: 15_000,
    });
    // still lost, and it can be tried again
    await expect(
      window.getByRole('button', { name: 'Reconnect' }),
    ).toBeEnabled();
  } finally {
    await app.close();
    await extra.stop().catch(() => undefined);
  }
});

test('the top bar counts the changes and the risky ones, switches Generate SQL on and off with a reason, reloads and arranges', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = 'billing.line_items';
  const generate = window.getByRole('button', { name: 'Generate SQL' });
  // a disabled button has no tooltip of its own, so the reason is on what it sits in
  const reason = () => generate.locator('..').getAttribute('title');
  await expect(window.getByText(/on .* · Postgres \d+/)).toBeVisible();
  await expect(generate).toBeDisabled();
  expect(await reason()).toMatch(/no changes/);
  await expect(window.getByText('0 changes', { exact: true })).toBeVisible();

  // a name a column of the table has already is an error
  const label = rowOf(window, table, 'label');
  await label.getByRole('button', { name: 'label', exact: true }).click();
  await window.keyboard.type('issued');
  await window.keyboard.press('Tab');
  await expect(generate).toBeDisabled();
  expect(await reason()).toMatch(/Fix this first/);

  // another name, and it is a change, a risky one: code that uses the old name breaks
  await window
    .getByRole('region', { name: table })
    .getByRole('listitem')
    .last()
    .getByRole('button', { name: 'issued', exact: true })
    .click();
  await window.keyboard.type('tag');
  await window.keyboard.press('Tab');
  await expect(generate).toBeEnabled();
  expect(await reason()).toBeNull();
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();
  await expect(window.getByText(/· 1 breaks app code/)).toBeVisible();

  // Reload asks first when there are edits to lose
  await window.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(
    window.getByRole('heading', {
      name: 'Reload and discard 1 unsaved change?',
    }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Cancel' }).click();
  await expect(window.getByRole('dialog')).toHaveCount(0);
  await expect(window.getByText('1 change', { exact: true })).toBeVisible();

  // Auto-arrange puts the tables where the layout wants them, and moved ones too
  const arranged = await spot(window, table);
  const header = window.getByRole('region', { name: table }).locator('header');
  const grab = (await header.boundingBox())!;
  // by the empty end of the header: its start is the schema, which is a button
  const [x, y] = [grab.x + grab.width - 40, grab.y + grab.height / 2];
  await window.mouse.move(x, y);
  await window.mouse.down();
  await window.mouse.move(x - 40, y + 60, { steps: 8 });
  await window.mouse.up();
  const moved = await spot(window, table);
  expect(moved).not.toBe(arranged);
  await window.getByRole('button', { name: 'Auto-arrange' }).click();
  await expect.poll(() => spot(window, table)).toBe(arranged);
  await app.close();
});

test('Generate SQL shows the SQL and its risks, and makes it again as the edits change', async () => {
  const { app, window } = await openEditor('billing.line_items');
  const table = 'billing.line_items';
  await rowOf(window, table, 'label')
    .getByRole('button', { name: 'label', exact: true })
    .click();
  await window.keyboard.type('title');
  await window.keyboard.press('Tab');

  await window.getByRole('button', { name: 'Generate SQL' }).click();
  const panel = window.getByRole('region', { name: 'SQL' });
  const text = panel.locator('.cm-content');
  await expect(text).toContainText('BEGIN;');
  await expect(text).toContainText('RENAME COLUMN "label" TO "title"');
  await expect(text).toContainText('COMMIT;');
  await expect(text).toContainText('-- Database:');

  // the risks, counted, and opening into what they are about
  const risk = panel.getByRole('button', { name: '1 breaks app code' });
  await expect(risk).toBeVisible();
  await expect(
    panel.getByRole('list', { name: 'Risks: breaks app code' }),
  ).toHaveCount(0);
  await risk.click();
  await expect(
    panel.getByRole('list', { name: 'Risks: breaks app code' }),
  ).toBeVisible();
  await expect(text).toContainText('-- WARNING (breaks app code)');

  // another edit while it is open: the SQL follows
  await rowOf(window, table, 'issued')
    .getByRole('button', { name: 'issued', exact: true })
    .click();
  await window.keyboard.type('day');
  await window.keyboard.press('Tab');
  await expect(text).toContainText('RENAME COLUMN "issued" TO "day"');
  await expect(text).toContainText('RENAME COLUMN "label" TO "title"');

  // dropping a column is destructive, and said so
  const row = rowOf(window, table, 'title');
  await row.hover();
  await row.getByRole('button', { name: 'Column actions' }).click();
  await window.getByRole('menuitem', { name: 'Delete column' }).click();
  await expect(
    panel.getByRole('button', { name: /destructive/ }),
  ).toBeVisible();
  await expect(text).toContainText('DROP COLUMN');

  await panel.getByRole('button', { name: 'Close the SQL panel' }).click();
  await expect(panel).toHaveCount(0);
  await app.close();
});

test('SQL is not made from a schema that changed under the edits: an unrelated change blocks it', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  try {
    const { app, window } = await launchApp();
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(window, 'public.scratch');
    await rowOf(window, 'public.scratch', 'a')
      .getByRole('button', { name: 'a', exact: true })
      .click();
    await window.keyboard.type('aa');
    await window.keyboard.press('Tab');
    await expect(changes(window, 1)).toBeVisible();

    // something else changed, which the edits know nothing about; asked for at once, before the poller
    await extra.admin.query('ALTER TABLE public.scratch ADD COLUMN c integer');
    await window.getByRole('button', { name: 'Generate SQL' }).click();
    const panel = window.getByRole('region', { name: 'SQL' });
    await expect(panel).toContainText(/changed outside pgsketch/, {
      timeout: 10_000,
    });
    await expect(panel.locator('.cm-editor')).toHaveCount(0);
    await expect(
      window.getByRole('button', { name: 'Generate SQL' }),
    ).toBeDisabled();

    await app.close();
  } finally {
    await extra.stop();
  }
});

test('an applied migration asked for at once is adopted, and there is nothing left to generate', async () => {
  test.setTimeout(120_000);
  const extra = await startScratchServer();
  try {
    const { app, window } = await launchApp();
    await connectThroughForm(window, extra, E2E_PASSWORD);
    await expect(window.locator('[data-layout="ready"]')).toHaveCount(1);
    await showTable(window, 'public.scratch');
    await rowOf(window, 'public.scratch', 'a')
      .getByRole('button', { name: 'a', exact: true })
      .click();
    await window.keyboard.type('aa');
    await window.keyboard.press('Tab');
    await extra.admin.query('ALTER TABLE public.scratch RENAME COLUMN a TO aa');
    await window.getByRole('button', { name: 'Generate SQL' }).click();
    const panel = window.getByRole('region', { name: 'SQL' });
    await expect(toastWith(window, 'Changes applied')).toBeVisible({
      timeout: 10_000,
    });
    await expect(panel).toContainText(/no changes to generate/);
    await expect(panel.locator('.cm-editor')).toHaveCount(0);
    await app.close();
  } finally {
    await extra.stop();
  }
});

test('a new table goes in the one schema the filter leaves showing', async () => {
  const { app, window } = await openEditor();
  await window.getByRole('button', { name: /^Schemas/ }).click();
  await window.getByRole('menuitemcheckbox', { name: 'public' }).click();
  await window.keyboard.press('Escape');
  await zoomUntil(window, false);
  const at = await emptyPoint(window);
  await window.mouse.dblclick(at.x, at.y);
  await expect(
    window.getByRole('region', { name: 'billing.new_table' }),
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

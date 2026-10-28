import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Introspection } from '@pgsketch/core';
import type { TestServer } from '../test/postgres';
import { launchApp } from './app';
import { E2E_PASSWORD, E2E_USER, startE2eServer } from './server';

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

test('the editor receives the fixture model, the cast data and the fingerprint', async () => {
  const { app, window } = await launchApp();
  const params = {
    kind: 'params',
    host: server.host,
    port: server.port,
    user: E2E_USER,
    password: E2E_PASSWORD,
    database: server.database,
    sslMode: 'disable',
  };
  const opened = await window.evaluate<{ status: string }>(
    `window.api.invoke('connection.open', ${JSON.stringify({ params, remember: false })})`,
  );
  expect(opened.status).toBe('opened');

  const { model, casts, fingerprint } = await window.evaluate<Introspection>(
    `window.api.invoke('schema.load')`,
  );
  const tables = Object.values(model.tables)
    .map((t) => t.name)
    .sort();
  expect(tables).toEqual(['invoices', 'line_items', 'users']);
  expect(Object.values(model.enums).map((e) => e.name)).toEqual([
    'user_status',
  ]);
  // the view is unmodeled, and so are the sequences behind the identity and serial columns
  expect(
    Object.values(model.unmodeled)
      .filter((u) => u.kind === 'view')
      .map((u) => u.name),
  ).toEqual(['open_invoices']);
  // the partial index is read-only, the plain one is editable
  const indexes = Object.fromEntries(
    Object.values(model.indexes).map((i) => [i.name, i.readOnly]),
  );
  expect(indexes).toMatchObject({
    invoices_open_idx: 'partial-index',
    invoices_user_id_idx: undefined,
  });
  expect(Object.keys(casts.casts).length).toBeGreaterThan(100);
  expect(fingerprint).toMatch(/^[0-9a-f]+$/);
  await app.close();
});

test('asking for the schema with no database open is an error the renderer can read', async () => {
  const { app, window } = await launchApp();
  const message = await window.evaluate<string>(
    `window.api.invoke('schema.load').then(() => 'loaded', (e) => e.message)`,
  );
  expect(message).toContain('No database is open');
  await app.close();
});

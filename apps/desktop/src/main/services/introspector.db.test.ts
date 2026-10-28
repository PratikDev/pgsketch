import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startServer, type TestServer } from '../../../test/postgres';
import { fakeIpc } from '../ipc/fake-ipc';
import { registerSchema } from '../ipc/schema';
import { testDeps } from '../ipc/test-deps';
import { openConnection, type ServerConnection } from './connection';
import { loadSchema } from './introspector';

// the same fixture every introspection test in core starts from
const FIXTURE = join(
  __dirname,
  '../../../../../packages/core/test/fixtures/basic.sql',
);

let server: TestServer;
let connection: ServerConnection;

beforeAll(async () => {
  server = await startServer(process.env.PG_VERSION ?? '16');
  await server.admin.query(readFileSync(FIXTURE, 'utf8'));
  connection = await openConnection({
    kind: 'params',
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database: server.database,
    sslMode: 'disable',
  });
});

afterAll(async () => {
  await connection?.close();
  await server?.stop();
});

describe('loadSchema', () => {
  test('reads the fixture: its tables, cast data and a fingerprint', async () => {
    const { model, casts, fingerprint } = await loadSchema(connection);
    const tables = Object.values(model.tables)
      .map((t) => t.name)
      .sort();
    expect(tables).toEqual(['invoices', 'line_items', 'users']);
    expect(
      Object.values(model.schemas)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['billing', 'public']);
    expect(Object.keys(casts.casts).length).toBeGreaterThan(100);
    expect(fingerprint).toMatch(/^[0-9a-f]+$/);
  });

  test('gives the same fingerprint twice with nothing changed, and another once something is', async () => {
    const first = (await loadSchema(connection)).fingerprint;
    expect((await loadSchema(connection)).fingerprint).toBe(first);
    await server.admin.query('CREATE TABLE public.extra (id int)');
    expect((await loadSchema(connection)).fingerprint).not.toBe(first);
    await server.admin.query('DROP TABLE public.extra');
  });

  test('is an exclusive section: a statement from elsewhere waits for the snapshot', async () => {
    const order: string[] = [];
    await Promise.all([
      loadSchema(connection).then(() => order.push('load')),
      connection.query('SELECT 1').then(() => order.push('other')),
    ]);
    expect(order).toEqual(['load', 'other']);
  });

  test('the schema.load channel reads the open database, and the result survives a copy through IPC', async () => {
    const { deps } = testDeps();
    await deps.session.replace({
      connection,
      info: {
        serverVersion: '16',
        database: 'x',
        host: 'h',
        hostKind: 'local',
        dbKey: 'k',
        saved: null,
      },
    });
    const ipc = fakeIpc();
    registerSchema(ipc, deps);
    const loaded = await ipc.invoke('schema.load');
    expect(structuredClone(loaded)).toEqual(loaded);
    expect(Object.keys(loaded.model.tables).length).toBe(3);
  });
});

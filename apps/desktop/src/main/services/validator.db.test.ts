import { fingerprint } from '@pgsketch/core';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { ConnectionParams } from '../../shared/ipc-contract';
import { startServer, type TestServer } from '../../../test/postgres';
import { openConnection, type ServerConnection } from './connection';
import { startPoller } from './poller';
import { openTaskConnection } from './task-connection';
import { createValidator } from './validator';

let server: TestServer;
let main: ServerConnection;

const params = (): ConnectionParams => ({
  kind: 'params',
  host: server.host,
  port: server.port,
  user: server.user,
  password: server.password,
  database: server.database,
  sslMode: 'disable',
});

beforeAll(async () => {
  server = await startServer(process.env.PG_VERSION ?? '16');
  main = await openConnection(params());
  await server.admin.query(
    'CREATE TABLE public.people (id int PRIMARY KEY, name text)',
  );
  await server.admin.query('INSERT INTO public.people (id) VALUES (1), (2)');
});
afterAll(async () => {
  await main?.close();
  await server?.stop();
});

const validator = () => createValidator(() => openTaskConnection(params()));
const current = () => fingerprint(main.query);
const tableExists = async (name: string) =>
  (
    await server.admin.query<{ t: string | null }>(
      'SELECT to_regclass($1)::text AS t',
      [name],
    )
  ).rows[0]?.t !== null;

describe('the validator on a real database', () => {
  test('a statement that fails stops the run there, the ones after it are not run, and nothing is kept', async () => {
    const before = await current();
    const result = await validator().validate(
      [
        'CREATE TABLE public.dry_a (id int)',
        'ALTER TABLE public.people ALTER COLUMN name SET NOT NULL',
        'CREATE TABLE public.dry_b (id int)',
      ],
      before,
    );
    expect(result).toMatchObject({
      status: 'done',
      results: [
        { status: 'passed' },
        { status: 'failed', code: '23502' },
        { status: 'not-run' },
      ],
    });
    expect(await tableExists('public.dry_a')).toBe(false);
    expect(await current()).toBe(before);
  });

  test('a run that passes everything still keeps nothing', async () => {
    const before = await current();
    const result = await validator().validate(
      ['CREATE TABLE public.dry_c (id int)', 'DROP TABLE public.people'],
      before,
    );
    expect(result).toEqual({
      status: 'done',
      results: [{ status: 'passed' }, { status: 'passed' }],
    });
    expect(await tableExists('public.people')).toBe(true);
    expect(await current()).toBe(before);
  });

  test('the poller reports nothing while a run is in progress', async () => {
    const onChange = vi.fn();
    const poller = startPoller(() => current(), onChange, 50);
    await poller.ready;
    const before = await current();
    await validator().validate(
      [
        'ALTER TABLE public.people ADD COLUMN nickname text',
        'SELECT pg_sleep(0.6)',
      ],
      before,
    );
    expect(onChange).not.toHaveBeenCalled();
    poller.stop();
  });

  test('a statement can not end the transaction by carrying a COMMIT', async () => {
    const before = await current();
    const result = await validator().validate(
      ["ALTER TABLE public.people ADD COLUMN sneaky text DEFAULT 'x'; COMMIT;"],
      before,
    );
    expect(result).toMatchObject({
      status: 'done',
      results: [{ status: 'failed' }],
    });
    expect(await current()).toBe(before);
  });

  test('a database that is not what the statements were made for is not touched', async () => {
    const stale = await current();
    await server.admin.query('CREATE TABLE public.moved (id int)');
    const result = await validator().validate(
      ['CREATE TABLE public.never (id int)'],
      stale,
    );
    expect(result).toEqual({ status: 'stale' });
    expect(await tableExists('public.never')).toBe(false);
    await server.admin.query('DROP TABLE public.moved');
  });

  test("runs with the connection's original search_path, so a name without a schema works", async () => {
    const before = await current();
    const result = await validator().validate(
      [
        'CREATE TABLE unqualified (id int)',
        'ALTER TABLE unqualified ADD COLUMN x int',
      ],
      before,
    );
    expect(result).toEqual({
      status: 'done',
      results: [{ status: 'passed' }, { status: 'passed' }],
    });
  });

  test('closes the connection it opened, after a pass and after a failure', async () => {
    const connections = async () =>
      Number(
        (
          await server.admin.query<{ n: string }>(
            "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = 'pgsketch'",
          )
        ).rows[0]?.n,
      );
    const baseline = await connections();
    const before = await current();
    await validator().validate(['SELECT 1', 'SELEKT 2'], before);
    await validator().validate(['SELECT 1'], before);
    await vi.waitFor(async () => expect(await connections()).toBe(baseline));
  });
});

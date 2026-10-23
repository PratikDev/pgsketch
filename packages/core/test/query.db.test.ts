import { Client } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { withSnapshot } from '../src/introspect/query';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS 'SELECT 1';
    CREATE TABLE public.t (a int DEFAULT public.f());
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const one = async <Row>(sql: string): Promise<Row> =>
  (await pg.query<Row>(sql))[0]!;

test('queries inside the snapshot run at repeatable read, read-only', async () => {
  await withSnapshot(pg.query, async () => {
    expect(
      await one<{ transaction_isolation: string }>(
        'SHOW transaction_isolation',
      ),
    ).toEqual({
      transaction_isolation: 'repeatable read',
    });
    expect(
      await one<{ transaction_read_only: string }>(
        'SHOW transaction_read_only',
      ),
    ).toEqual({
      transaction_read_only: 'on',
    });
  });
});

test('writes are rejected, and the connection is usable afterwards', async () => {
  await expect(
    withSnapshot(pg.query, () => pg.query('CREATE TABLE public.nope (a int)')),
  ).rejects.toMatchObject({ code: '25006' });
  expect(await one<{ n: number }>('SELECT 1 AS n')).toEqual({ n: 1 });
  expect(
    await pg.query(`SELECT 1 FROM pg_class WHERE relname = 'nope'`),
  ).toEqual([]);
});

test('the snapshot ends cleanly: no transaction stays open', async () => {
  await withSnapshot(pg.query, () => pg.query('SELECT 1'));
  expect(
    await one<{ transaction_isolation: string }>('SHOW transaction_isolation'),
  ).toEqual({
    transaction_isolation: 'read committed',
  });
});

test('changes committed by another connection are invisible inside the snapshot', async () => {
  const other = new Client({ connectionString: pg.connectionUri });
  await other.connect();
  try {
    const seen = await withSnapshot(pg.query, async () => {
      await pg.query('SELECT 1'); // the snapshot is taken at the first query
      await other.query('CREATE TABLE public.late (a int)');
      return pg.query(`SELECT 1 FROM pg_class WHERE relname = 'late'`);
    });
    expect(seen).toEqual([]);
    expect(
      await pg.query(`SELECT 1 FROM pg_class WHERE relname = 'late'`),
    ).toHaveLength(1);
  } finally {
    await other.end();
  }
});

test('expressions come back fully qualified inside the snapshot', async () => {
  const sql = `SELECT pg_get_expr(adbin, adrelid) AS expr FROM pg_attrdef
                WHERE adrelid = 'public.t'::regclass`;
  expect(await one<{ expr: string }>(sql)).toEqual({ expr: 'f()' });
  const inside = await withSnapshot(pg.query, () => one<{ expr: string }>(sql));
  expect(inside).toEqual({ expr: 'public.f()' });
});

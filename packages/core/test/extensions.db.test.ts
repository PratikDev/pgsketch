import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  listExtensionOwned,
  notExtensionOwned,
} from '../src/introspect/extensions';
import { oidOf, startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE EXTENSION pg_trgm;
    CREATE TABLE public.user_table (a int);
    CREATE TABLE public.ext_table (a int);
    ALTER EXTENSION pg_trgm ADD TABLE public.ext_table;
  `);
});

afterAll(async () => {
  await pg?.stop();
});

test('after CREATE EXTENSION pg_trgm its objects are listed', async () => {
  const owned = await listExtensionOwned(pg.query);
  const has = (catalog: string, oid: number) =>
    owned.some((o) => o.catalog === catalog && o.oid === oid);
  expect(
    has(
      'pg_proc',
      await oidOf(
        pg.query,
        `'public.similarity(text,text)'::regprocedure::oid`,
      ),
    ),
  ).toBe(true);
  expect(
    has('pg_type', await oidOf(pg.query, `'public.gtrgm'::regtype::oid`)),
  ).toBe(true);
  expect(
    has('pg_class', await oidOf(pg.query, `'public.ext_table'::regclass::oid`)),
  ).toBe(true);
});

test('objects that are not part of an extension are not listed', async () => {
  const owned = await listExtensionOwned(pg.query);
  const userTable = await oidOf(pg.query, `'public.user_table'::regclass::oid`);
  expect(
    owned.some((o) => o.catalog === 'pg_class' && o.oid === userTable),
  ).toBe(false);
  expect(owned.every((o) => Number.isInteger(o.oid))).toBe(true);
});

test('the SQL condition excludes extension-owned objects only', async () => {
  const rows = await pg.query<{ relname: string }>(
    `SELECT relname FROM pg_class WHERE relname IN ('user_table', 'ext_table')
        AND ${notExtensionOwned('pg_class', 'pg_class.oid')}`,
  );
  expect(rows).toEqual([{ relname: 'user_table' }]);
});

test('dropping the extension removes its objects from the list', async () => {
  const before = await listExtensionOwned(pg.query);
  await pg.query('DROP EXTENSION pg_trgm CASCADE');
  const after = await listExtensionOwned(pg.query);
  expect(after.length).toBeLessThan(before.length);
  // what is left belongs to plpgsql, which every database has: a language and its functions
  expect(new Set(after.map((o) => o.catalog))).toEqual(
    new Set(['pg_language', 'pg_proc']),
  );
});

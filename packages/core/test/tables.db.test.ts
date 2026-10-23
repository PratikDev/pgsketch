import { afterAll, beforeAll, expect, test } from 'vitest';
import { schemaId, tableId } from '../src/model/ids';
import { introspectTables } from '../src/introspect/tables';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE SCHEMA app;
    CREATE TABLE public.plain (a int);
    CREATE TABLE public.commented (a int);
    COMMENT ON TABLE public.commented IS 'it''s a "comment"';
    CREATE TABLE app.same_name (a int);
    CREATE TABLE public.same_name (a int);
    CREATE TABLE public.events (id int, day date) PARTITION BY RANGE (day);
    CREATE TABLE public.events_2024 PARTITION OF public.events
      FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    CREATE TABLE public.events_sub PARTITION OF public.events
      FOR VALUES FROM ('2025-01-01') TO ('2026-01-01') PARTITION BY HASH (id);
    CREATE VIEW public.a_view AS SELECT 1 AS a;
    CREATE MATERIALIZED VIEW public.a_matview AS SELECT 1 AS a;
    CREATE SEQUENCE public.a_seq;
    CREATE TEMP TABLE temp_probe (a int);
    CREATE EXTENSION pg_trgm;
    CREATE TABLE public.ext_table (a int);
    ALTER EXTENSION pg_trgm ADD TABLE public.ext_table;
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const tables = async () =>
  Object.fromEntries(
    (await introspectTables(pg.query)).map((t) => [`${t.name}`, t]),
  );

test('fixture tables are returned with and without comments', async () => {
  const t = await tables();
  expect(t.plain).toMatchObject({ name: 'plain', comment: null });
  expect(t.commented).toMatchObject({ comment: 'it\'s a "comment"' });
  expect(t.plain).not.toHaveProperty('readOnly');
});

test('ids and schemas come from OIDs; same name in two schemas gives two tables', async () => {
  const all = await introspectTables(pg.query);
  const same = all.filter((x) => x.name === 'same_name');
  expect(same).toHaveLength(2);
  expect(new Set(same.map((x) => x.id)).size).toBe(2);
  const { oid } = (
    await pg.query<{ oid: number | string }>(
      `SELECT 'public.plain'::regclass::oid AS oid`,
    )
  )[0]!;
  const { s } = (
    await pg.query<{ s: number | string }>(
      `SELECT oid AS s FROM pg_namespace WHERE nspname = 'public'`,
    )
  )[0]!;
  expect(all.find((x) => x.name === 'plain')).toMatchObject({
    id: tableId(oid!),
    schemaId: schemaId(s!),
  });
});

test('a partition child is marked read-only, and so is the partitioned table', async () => {
  const t = await tables();
  expect(t.events!.readOnly).toBe('partitioned-table');
  expect(t.events_2024!.readOnly).toBe('partition');
  // a partition that is itself partitioned is still a partition
  expect(t.events_sub!.readOnly).toBe('partition');
});

test('views, sequences, temp tables and extension tables are not tables', async () => {
  const names = Object.keys(await tables());
  for (const excluded of [
    'a_view',
    'a_matview',
    'a_seq',
    'temp_probe',
    'ext_table',
  ]) {
    expect(names).not.toContain(excluded);
  }
});

test('tables in system schemas are not returned', async () => {
  const names = Object.keys(await tables());
  expect(
    names.filter((n) => n.startsWith('pg_') || n.startsWith('sql_')),
  ).toEqual([]);
});

import { afterAll, beforeAll, expect, test } from 'vitest';
import { introspectUnmodeled } from '../src/introspect/unmodeled';
import { withSnapshot } from '../src/introspect/query';
import type { UnmodeledObject } from '../src/model/types';
import { oidOf, startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE TABLE public.t (a int, b int, c int GENERATED ALWAYS AS IDENTITY, s serial);
    CREATE TABLE public.parent (id int PRIMARY KEY);
    CREATE TABLE public.child (pid int REFERENCES public.parent (id));
    CREATE VIEW public.v AS SELECT a FROM public.t;
    CREATE VIEW public.v_on_v AS SELECT a FROM public.v;
    CREATE MATERIALIZED VIEW public.mv AS SELECT b FROM public.t;
    CREATE SEQUENCE public.standalone_seq;
    CREATE FUNCTION public.noop() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
    CREATE TRIGGER trg BEFORE UPDATE OF b ON public.t FOR EACH ROW EXECUTE FUNCTION public.noop();
    CREATE FUNCTION public.counter() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT count(*)::int FROM public.t; END;
    ALTER TABLE public.t ENABLE ROW LEVEL SECURITY;
    CREATE POLICY pol ON public.t USING (a > 0);
    CREATE FOREIGN DATA WRAPPER dummy;
    CREATE SERVER srv FOREIGN DATA WRAPPER dummy;
    CREATE FOREIGN TABLE public.ft (x int) SERVER srv;
    CREATE EXTENSION pg_trgm;
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const all = () => withSnapshot(pg.query, () => introspectUnmodeled(pg.query));
const find = async (kind: string, name: string): Promise<UnmodeledObject> =>
  (await all()).find((o) => o.kind === kind && o.name === name)!;

const columnId = async (table: string, column: string) => {
  const row = (
    await pg.query<{ id: string }>(
      `SELECT 'c:' || attrelid::int8 || ':' || attnum AS id FROM pg_attribute
        WHERE attrelid = 'public.${table}'::regclass AND attname = '${column}'`,
    )
  )[0]!;
  return row.id;
};
const tableId = async (table: string) =>
  `t:${await oidOf(pg.query, `'public.${table}'::regclass::oid`)}`;

test('a view depending on a column is linked to that column', async () => {
  const v = await find('view', 'v');
  expect(v.columnIds).toEqual([await columnId('t', 'a')]);
  expect(v.ownerTableId).toBeNull(); // only triggers and policies have an owner
  expect(v.tableIds).toEqual([await tableId('t')]);
});

test('a materialized view is linked to the column it reads', async () => {
  const mv = await find('materialized-view', 'mv');
  expect(mv.columnIds).toEqual([await columnId('t', 'b')]);
});

test('a view on a view is linked only to what it reads directly', async () => {
  const v = await find('view', 'v_on_v');
  expect(v.tableIds).toEqual([]);
  expect(v.columnIds).toEqual([]);
});

test('sequences behind serial and identity columns are linked to their column; a standalone one is not', async () => {
  const seqs = (await all()).filter((o) => o.kind === 'sequence');
  expect(seqs.find((s) => s.name === 't_s_seq')!.columnIds).toEqual([
    await columnId('t', 's'),
  ]);
  expect(seqs.find((s) => s.name === 't_c_seq')!.columnIds).toEqual([
    await columnId('t', 'c'),
  ]);
  expect(seqs.find((s) => s.name === 'standalone_seq')).toMatchObject({
    tableIds: [],
    columnIds: [],
  });
});

test('a trigger is linked to its table and the columns in UPDATE OF', async () => {
  const trigger = await find('trigger', 'trg');
  expect(trigger.schemaId).toBeNull();
  expect(trigger.ownerTableId).toBe(await tableId('t'));
  expect(trigger.tableIds).toEqual([await tableId('t')]);
  expect(trigger.columnIds).toEqual([await columnId('t', 'b')]);
});

test('a policy is linked to its table and the columns it uses', async () => {
  const policy = await find('policy', 'pol');
  expect(policy.ownerTableId).toBe(await tableId('t'));
  expect(policy.tableIds).toEqual([await tableId('t')]);
  expect(policy.columnIds).toEqual([await columnId('t', 'a')]);
});

test('functions in user schemas are listed, and a SQL-body function is linked to its table', async () => {
  expect((await find('function', 'noop')).schemaId).not.toBeNull();
  expect((await find('function', 'counter')).tableIds).toEqual([
    await tableId('t'),
  ]);
});

test('a foreign table is listed', async () => {
  expect(await find('foreign-table', 'ft')).toMatchObject({
    name: 'ft',
    tableIds: [],
  });
});

test('system and extension objects, and internal triggers, are not listed', async () => {
  const objects = await all();
  const names = objects.map((o) => o.name);
  expect(names).not.toContain('pg_stat_activity'); // system view
  expect(names).not.toContain('similarity'); // pg_trgm function
  expect(names).not.toContain('pg_get_expr'); // built-in function
  // foreign keys create internal triggers on both tables; none of them may be listed
  expect(
    objects.filter((o) => o.kind === 'trigger').map((o) => o.name),
  ).toEqual(['trg']);
});

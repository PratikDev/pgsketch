import { afterAll, beforeAll, expect, test } from 'vitest';
import { introspectIndexes } from '../src/introspect/indexes';
import { withSnapshot } from '../src/introspect/query';
import type { Index } from '../src/model/types';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE TABLE public.t (id int PRIMARY KEY, a int, b int, c int, d int, e text, doc jsonb, f int, g int,
                           UNIQUE (g), EXCLUDE USING btree (f WITH =));
    CREATE INDEX plain ON public.t (a);
    CREATE UNIQUE INDEX uniq ON public.t (b);
    CREATE INDEX composite ON public.t (c, a);
    CREATE INDEX partial ON public.t (a) WHERE a > 0;
    CREATE INDEX expr ON public.t ((a + b), c);
    CREATE INDEX gin_doc ON public.t USING gin (doc);
    CREATE INDEX desc_idx ON public.t (a DESC);
    CREATE INDEX nulls_first ON public.t (b NULLS FIRST);
    CREATE INDEX with_include ON public.t (c) INCLUDE (d);
    CREATE INDEX pattern_ops ON public.t (e text_pattern_ops);
    CREATE INDEX fill ON public.t (d) WITH (fillfactor = 70);
    CREATE TABLE public.events (id int, day date) PARTITION BY RANGE (day);
    CREATE TABLE public.refs (b int REFERENCES public.t (b)); -- uses the unique index "uniq"
    CREATE INDEX events_id ON public.events (id);
    CREATE TABLE public.events_2024 PARTITION OF public.events FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const named = async (): Promise<Record<string, Index>> =>
  Object.fromEntries(
    (await withSnapshot(pg.query, () => introspectIndexes(pg.query))).map(
      (i) => [i.name, i],
    ),
  );

const columnNames = async (index: Index) => {
  const rows = await pg.query<{ attnum: number; attname: string }>(
    `SELECT attnum, attname FROM pg_attribute WHERE attrelid = 'public.t'::regclass AND attnum > 0`,
  );
  const byId = new Map(
    rows.map((r) => [`c:${index.tableId.slice(2)}:${r.attnum}`, r.attname]),
  );
  return index.columnIds.map((id) => byId.get(id));
};

test("a unique index that a foreign key relies on is still listed, a constraint's own index is not", async () => {
  const i = await named();
  expect(i.uniq).toMatchObject({ unique: true });
  expect(Object.keys(i)).not.toContain('t_pkey');
  expect(Object.keys(i)).not.toContain('t_g_key');
});

test('plain, unique and composite B-tree indexes are editable', async () => {
  const i = await named();
  for (const name of ['plain', 'uniq', 'composite'])
    expect(i[name]).not.toHaveProperty('readOnly');
  expect(i.uniq!.unique).toBe(true);
  expect(i.plain!.unique).toBe(false);
  expect(await columnNames(i.composite!)).toEqual(['c', 'a']);
});

test('partial, expression, GIN, DESC, INCLUDE, opclass, storage and NULLS FIRST indexes are read-only', async () => {
  const i = await named();
  expect(i.partial!.readOnly).toBe('partial-index');
  expect(i.expr!.readOnly).toBe('expression-index');
  expect(i.gin_doc!.readOnly).toBe('non-btree-index');
  expect(i.desc_idx!.readOnly).toBe('desc-index');
  expect(i.nulls_first!.readOnly).toBe('desc-index');
  expect(i.with_include!.readOnly).toBe('include-index');
  expect(i.pattern_ops!.readOnly).toBe('opclass-index');
  expect(i.fill!.readOnly).toBe('storage-options-index');
  expect(i.partial!.definition).toMatch(/WHERE \(?a > 0\)?/);
});

test('read-only indexes list every column they use', async () => {
  const i = await named();
  expect(await columnNames(i.expr!)).toEqual(['c', 'a', 'b']);
  expect(await columnNames(i.partial!)).toEqual(['a']);
  expect(await columnNames(i.with_include!)).toEqual(['c', 'd']);
});

test('indexes behind a PK, unique or exclusion constraint are folded into the constraint', async () => {
  const names = Object.keys(await named());
  expect(names).not.toContain('t_pkey');
  expect(names).not.toContain('t_g_key');
  expect(names).not.toContain('t_f_excl');
});

test('indexes of partitioned tables and partitions are read-only for the table', async () => {
  const i = await named();
  expect(i.events_id!.readOnly).toBe('partitioned-table');
  const child = Object.values(i).find((x) => x.name.startsWith('events_2024'));
  expect(child!.readOnly).toBe('partition');
});

test.skipIf(Number(process.env.PG_VERSION ?? '16') < 15)(
  'Postgres 15+: a unique index with NULLS NOT DISTINCT is read-only',
  async () => {
    await pg.query(
      `CREATE UNIQUE INDEX nnd ON public.t (a) NULLS NOT DISTINCT`,
    );
    expect((await named()).nnd!.readOnly).toBe('nulls-not-distinct-index');
  },
);

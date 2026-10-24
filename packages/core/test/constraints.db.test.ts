import { afterAll, beforeAll, expect, test } from 'vitest';
import { introspectConstraints } from '../src/introspect/constraints';
import { withSnapshot } from '../src/introspect/query';
import type { Constraint } from '../src/model/types';
import { oidOf, startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;
const major = () => Number(pg.version);

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE TABLE public.parent (a int, b int, PRIMARY KEY (a, b));
    CREATE TABLE public.child (
      id int PRIMARY KEY, x int, y int,
      CONSTRAINT child_fk FOREIGN KEY (x, y) REFERENCES public.parent (a, b)
        ON DELETE CASCADE ON UPDATE RESTRICT,
      CONSTRAINT child_check CHECK (x < y AND y > 0),
      CONSTRAINT child_single CHECK (x > 0),
      CONSTRAINT child_free CHECK (true)
    );
    CREATE TABLE public.only_not_null (a int NOT NULL, b int NOT NULL);
    CREATE TABLE public.actions (
      a int UNIQUE, b int, c int, d int, e int,
      FOREIGN KEY (b) REFERENCES public.actions (a) ON DELETE SET NULL ON UPDATE SET DEFAULT,
      FOREIGN KEY (c) REFERENCES public.actions (a) ON DELETE SET DEFAULT ON UPDATE CASCADE,
      FOREIGN KEY (d) REFERENCES public.actions (a) ON DELETE RESTRICT ON UPDATE NO ACTION
    );
    CREATE TABLE public.odd (
      a int, b int, c int, d int, e int,
      CONSTRAINT odd_deferrable UNIQUE (a) DEFERRABLE,
      CONSTRAINT odd_include UNIQUE (b) INCLUDE (c),
      CONSTRAINT odd_fillfactor UNIQUE (d) WITH (fillfactor = 70),
      CONSTRAINT odd_excl EXCLUDE USING btree (e WITH =),
      CONSTRAINT odd_noinherit CHECK (a > 0) NO INHERIT
    );
    CREATE TABLE public.odd_fk (r int, s int);
    ALTER TABLE public.odd_fk ADD CONSTRAINT odd_fk_notvalid FOREIGN KEY (r) REFERENCES public.actions (a) NOT VALID;
    CREATE TABLE public.full_target (a int, b int, UNIQUE (a, b));
    CREATE TABLE public.full_fk (a int, b int,
      CONSTRAINT full_fk_full FOREIGN KEY (a, b) REFERENCES public.full_target (a, b) MATCH FULL);
    CREATE TABLE public.events (id int, day date, PRIMARY KEY (id, day)) PARTITION BY RANGE (day);
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const all = () => withSnapshot(pg.query, () => introspectConstraints(pg.query));
const named = async (): Promise<Record<string, Constraint>> =>
  Object.fromEntries((await all()).map((c) => [c.name, c]));

test('composite PK and multi-column FK with ON DELETE CASCADE', async () => {
  const c = await named();
  expect(c.parent_pkey).toMatchObject({ kind: 'pk' });
  expect(c.parent_pkey!.columnIds).toHaveLength(2);
  expect(c.child_fk).toMatchObject({
    kind: 'fk',
    onDelete: 'cascade',
    onUpdate: 'restrict',
  });
  const fk = c.child_fk as Extract<Constraint, { kind: 'fk' }>;
  expect(fk.columnIds).toHaveLength(2);
  expect(fk.refColumnIds).toEqual(c.parent_pkey!.columnIds);
  expect(c.child_fk).not.toHaveProperty('readOnly');
});

test('every foreign key action is read', async () => {
  const fks = (await all()).filter(
    (c): c is Extract<Constraint, { kind: 'fk' }> =>
      c.kind === 'fk' && c.name.startsWith('actions_'),
  );
  const actions = fks.map((f) => `${f.onDelete}/${f.onUpdate}`).sort();
  expect(actions).toEqual([
    'restrict/no action',
    'set default/cascade',
    'set null/set default',
  ]);
});

test('NOT NULL columns produce no constraint objects (also on Postgres 18)', async () => {
  const oid = await oidOf(pg.query, `'public.only_not_null'::regclass::oid`);
  expect((await all()).filter((c) => c.tableId === `t:${oid}`)).toEqual([]);
  if (major() >= 18) {
    const rows = await pg.query(
      `SELECT 1 FROM pg_constraint WHERE conrelid = 'public.only_not_null'::regclass AND contype = 'n'`,
    );
    expect(rows.length).toBeGreaterThan(0); // they exist in the catalog, and are skipped
  }
});

test('a multi-column check lists both columns', async () => {
  const c = await named();
  const check = c.child_check as Extract<Constraint, { kind: 'check' }>;
  expect(check.columnIds).toHaveLength(2);
  expect(check.expression).toMatch(/x < y/);
  expect(
    (c.child_single as Extract<Constraint, { kind: 'check' }>).columnIds,
  ).toHaveLength(1);
  expect(c.child_free!.columnIds).toEqual([]);
});

test('a NOT VALID foreign key is read-only', async () => {
  expect((await named()).odd_fk_notvalid).toMatchObject({
    readOnly: 'not-valid',
  });
});

test('deferrable, NO INHERIT, MATCH FULL and exclusion constraints are read-only', async () => {
  const c = await named();
  expect(c.odd_deferrable!.readOnly).toBe('deferrable');
  expect(c.odd_noinherit!.readOnly).toBe('no-inherit');
  expect(c.full_fk_full!.readOnly).toBe('match-full');
  expect(c.odd_excl).toMatchObject({
    kind: 'exclusion',
    readOnly: 'exclusion',
  });
  expect(c.odd_excl!.definition).toMatch(/EXCLUDE USING btree/);
});

test('a unique constraint with INCLUDE or storage options is read-only, a plain one is not', async () => {
  const c = await named();
  expect(c.odd_include!.readOnly).toBe('include-index');
  expect(c.odd_fillfactor!.readOnly).toBe('storage-options-index');
  expect(c.actions_a_key).not.toHaveProperty('readOnly');
  expect(c.child_pkey).not.toHaveProperty('readOnly');
});

test('a constraint on a partitioned table is read-only for the table', async () => {
  expect((await named()).events_pkey!.readOnly).toBe('partitioned-table');
});

test.skipIf(Number(process.env.PG_VERSION ?? '16') < 15)(
  'Postgres 15+: NULLS NOT DISTINCT and ON DELETE SET NULL (columns) are read-only',
  async () => {
    await pg.query(`
      CREATE TABLE public.v15 (a int, b int, c int,
        CONSTRAINT v15_nnd UNIQUE NULLS NOT DISTINCT (a),
        UNIQUE (b, c));
      CREATE TABLE public.v15_fk (b int, c int,
        CONSTRAINT v15_fk_cols FOREIGN KEY (b, c) REFERENCES public.v15 (b, c) ON DELETE SET NULL (c));
    `);
    const c = await named();
    expect(c.v15_nnd!.readOnly).toBe('nulls-not-distinct-index');
    expect(c.v15_fk_cols!.readOnly).toBe('fk-set-columns');
  },
);

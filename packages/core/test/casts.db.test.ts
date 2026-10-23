import { afterAll, beforeAll, expect, test } from 'vitest';
import { introspectCasts } from '../src/introspect/casts';
import { withSnapshot } from '../src/introspect/query';
import type { PgType } from '../src/model/types';
import { parsePgType } from '../src/sql/pgtype';
import { needsUsing, typeKey, type CastData } from '../src/sql/coercion';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;
let data: CastData;
const parsed = new Map<string, PgType>();

const types = [
  'smallint',
  'integer',
  'bigint',
  'numeric(10,2)',
  'numeric(5,1)',
  'real',
  'double precision',
  'text',
  'varchar(10)',
  'varchar(50)',
  'char(5)',
  'uuid',
  'boolean',
  'date',
  'timestamp',
  'timestamptz',
  'time',
  'interval',
  'bytea',
  'jsonb',
  'json',
  'public.mood',
  'public.other',
  'integer[]',
  'bigint[]',
  'text[]',
  'varchar(10)[]',
  'public.mood[]',
  'public.posint',
  'public.shorttext',
];

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE TYPE public.mood AS ENUM ('happy');
    CREATE TYPE public.other AS ENUM ('x');
    CREATE DOMAIN public.posint AS integer CHECK (VALUE > 0);
    CREATE DOMAIN public.shorttext AS varchar(5);
  `);
  data = await withSnapshot(pg.query, () => introspectCasts(pg.query));
  for (const sqlType of types) {
    await pg.query(
      `DROP TABLE IF EXISTS public.probe; CREATE TABLE public.probe (c ${sqlType})`,
    );
    const row = (
      await withSnapshot(pg.query, () =>
        pg.query<{ t: string }>(
          `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid = 'public.probe'::regclass AND attname = 'c'`,
        ),
      )
    )[0]!;
    parsed.set(sqlType, parsePgType(row.t));
  }
}, 120_000);

afterAll(async () => {
  await pg?.stop();
});

test('the cast data covers all of pg_cast for the types it knows', async () => {
  const total = Number(
    (
      await pg.query<{ n: number | string }>(
        'SELECT count(*) AS n FROM pg_cast',
      )
    )[0]!.n,
  );
  expect(Object.keys(data.casts).length).toBeGreaterThan(100);
  expect(Object.keys(data.casts).length).toBeLessThanOrEqual(total);
  expect(data.casts['integer>bigint']).toBe('i');
  expect(data.casts['bigint>integer']).toBe('a');
  expect(data.categories.text).toBe('S');
  expect(data.categories['public.mood']).toBe('E');
  expect(data.domains['public.posint']).toBe('integer');
  expect(data.domains['public.shorttext']).toBe('varchar');
});

/** What Postgres says: can this conversion happen without USING? */
async function postgresNeedsUsing(
  from: string,
  to: string,
  destination: string,
): Promise<boolean> {
  await pg.query('BEGIN');
  let alterFails = false;
  try {
    await pg.query(`ALTER TABLE public.src ALTER COLUMN c TYPE ${to}`);
  } catch {
    alterFails = true;
  }
  await pg.query('ROLLBACK');
  let insertFails = false;
  try {
    await pg.query(`INSERT INTO ${destination} SELECT c FROM public.src`);
  } catch {
    insertFails = true;
  }
  // the plan's test: an INSERT of the old type into the new type; it must agree with ALTER itself
  expect(insertFails, `${from} -> ${to}: INSERT and ALTER disagree`).toBe(
    alterFails,
  );
  return alterFails;
}

test('needsUsing agrees with Postgres for every pair of common types', async () => {
  const destinations = new Map<string, string>();
  for (const [i, sqlType] of types.entries()) {
    await pg.query(`CREATE TABLE public.dst_${i} (c ${sqlType})`);
    destinations.set(sqlType, `public.dst_${i}`);
  }
  const disagreements: string[] = [];
  for (const from of types) {
    await pg.query(
      `DROP TABLE IF EXISTS public.src; CREATE TABLE public.src (c ${from})`,
    );
    for (const to of types) {
      const real = await postgresNeedsUsing(from, to, destinations.get(to)!);
      const ours = needsUsing(parsed.get(from)!, parsed.get(to)!, data);
      if (real !== ours)
        disagreements.push(
          `${from} -> ${to}: postgres needs USING ${real}, ours ${ours}`,
        );
    }
  }
  expect(disagreements).toEqual([]);
}, 300_000);

test('every type in the matrix is known to the cast data', () => {
  for (const t of parsed.values())
    expect(data.categories[typeKey(t)]).toBeDefined();
});

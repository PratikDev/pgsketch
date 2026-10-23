import { afterAll, beforeAll, expect, test } from 'vitest';
import { parsePgType, renderPgType } from '../src/sql/pgtype';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  // The app pins an empty search_path, so user types come back schema-qualified.
  await pg.client.query(`
    SET search_path = '';
    CREATE SCHEMA "My Schema";
    CREATE TYPE public.mood AS ENUM ('happy');
    CREATE TYPE "My Schema"."Mood" AS ENUM ('sad');
    CREATE DOMAIN public.posint AS integer;
  `);
});

afterAll(async () => {
  await pg?.stop();
});

async function formatColumnType(sqlType: string): Promise<string> {
  await pg.client.query(
    `DROP TABLE IF EXISTS public.probe; CREATE TABLE public.probe (c ${sqlType})`,
  );
  const { rows } = await pg.client.query<{ t: string }>(
    `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
     WHERE attrelid = 'public.probe'::regclass AND attname = 'c'`,
  );
  return rows[0]!.t;
}

const declared = [
  'integer',
  'bigint',
  'smallint',
  'text',
  'boolean',
  'uuid',
  'jsonb',
  'real',
  'double precision',
  'varchar(255)',
  'varchar',
  'char(10)',
  'bpchar',
  'numeric(10,2)',
  'numeric(10)',
  'numeric',
  'timestamptz',
  'timestamp(3)',
  'timestamptz(6)',
  'time(2)',
  'timetz',
  'date',
  'interval',
  'interval(3)',
  'interval day to second(3)',
  'interval year to month',
  'bit(3)',
  'varbit(5)',
  '"char"',
  'text[]',
  'varchar(10)[]',
  'numeric(10,2)[]',
  'integer[][]',
  'public.mood',
  'public.mood[]',
  '"My Schema"."Mood"',
  '"My Schema"."Mood"[]',
  'public.posint',
];

test('parsing and re-rendering format_type output keeps every type identical', async () => {
  const mismatches: string[] = [];
  for (const sqlType of declared) {
    const original = await formatColumnType(sqlType);
    const rendered = renderPgType(parsePgType(original));
    const roundTripped = await formatColumnType(rendered);
    if (roundTripped !== original)
      mismatches.push(
        `${sqlType}: ${original} -> ${rendered} -> ${roundTripped}`,
      );
  }
  expect(mismatches).toEqual([]);
});

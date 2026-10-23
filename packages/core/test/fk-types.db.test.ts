import { afterAll, beforeAll, expect, test } from 'vitest';
import { fkTypesCompatible } from '../src/model/fk-types';
import { parsePgType } from '../src/sql/pgtype';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.client.query(
    `CREATE TYPE public.mood AS ENUM ('happy'); CREATE TYPE public.other AS ENUM ('x')`,
  );
});

afterAll(async () => {
  await pg?.stop();
});

const types = [
  'smallint',
  'integer',
  'bigint',
  'numeric(10,2)',
  'real',
  'double precision',
  'text',
  'varchar(10)',
  'char(5)',
  'uuid',
  'date',
  'timestamp',
  'timestamptz',
  'boolean',
  'bytea',
  'public.mood',
  'public.other',
  'integer[]',
  'bigint[]',
  'text[]',
  'varchar(10)[]',
  'numeric(10,2)[]',
  'time',
  'timetz',
  'interval',
];

/** Asks Postgres whether a column of type `fkType` can reference a key column of type `keyType`. */
async function postgresAllows(
  fkType: string,
  keyType: string,
): Promise<boolean> {
  await pg.client.query(
    `DROP TABLE IF EXISTS public.child; DROP TABLE IF EXISTS public.parent`,
  );
  await pg.client.query(
    `CREATE TABLE public.parent (k ${keyType} PRIMARY KEY)`,
  );
  try {
    await pg.client.query(
      `CREATE TABLE public.child (r ${fkType} REFERENCES public.parent (k))`,
    );
    return true;
  } catch {
    return false;
  }
}

async function formatted(sqlType: string): Promise<string> {
  await pg.client.query(
    `DROP TABLE IF EXISTS public.probe; CREATE TABLE public.probe (c ${sqlType})`,
  );
  const { rows } = await pg.client.query<{ t: string }>(
    `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
     WHERE attrelid = 'public.probe'::regclass AND attname = 'c'`,
  );
  return rows[0]!.t;
}

test('fkTypesCompatible agrees with Postgres for every pair of common types', async () => {
  const parsed = new Map<string, ReturnType<typeof parsePgType>>();
  for (const t of types) parsed.set(t, parsePgType(await formatted(t)));

  const disagreements: string[] = [];
  for (const fkType of types) {
    for (const keyType of types) {
      const real = await postgresAllows(fkType, keyType);
      const ours = fkTypesCompatible(parsed.get(fkType)!, parsed.get(keyType)!);
      if (real !== ours)
        disagreements.push(
          `${fkType} -> ${keyType}: postgres ${real}, ours ${ours}`,
        );
    }
  }
  expect(disagreements).toEqual([]);
}, 300_000);

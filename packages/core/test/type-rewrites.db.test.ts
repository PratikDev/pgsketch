import { afterAll, beforeAll, expect, test } from 'vitest';
import { typeChangeRewritesTable } from '../src/risk/type-changes';
import { parsePgType } from '../src/sql/pgtype';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

/** [from, to, a value, whether we say the change rewrites the table] */
const cases: [string, string, string, boolean][] = [
  ['smallint', 'integer', '1', true],
  ['integer', 'bigint', '1', true],
  ['varchar(10)', 'varchar(20)', `'abc'`, false],
  ['varchar(10)', 'varchar', `'abc'`, false],
  ['varchar(10)', 'text', `'abc'`, false],
  ['varchar', 'text', `'abc'`, false],
  ['text', 'varchar', `'abc'`, false],
  ['numeric(10,2)', 'numeric(12,2)', '1.25', false],
  ['numeric(10)', 'numeric(12)', '5', false],
  ['numeric(10,2)', 'numeric(10,1)', '1.25', true],
  ['real', 'integer', '1.5', true],
  ['timestamp', 'date', `'2026-10-24 13:45:00'`, true],
  ['text', 'varchar(10)', `'abc'`, true],
];

async function typeOf(sqlType: string) {
  await pg.query(
    `DROP TABLE IF EXISTS public.probe; CREATE TABLE public.probe (c ${sqlType})`,
  );
  const [row] = await pg.query<{ t: string }>(
    `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid = 'public.probe'::regclass AND attname = 'c'`,
  );
  return parsePgType(row!.t);
}

const filenode = async () =>
  (
    await pg.query<{ f: string }>(
      `SELECT pg_relation_filenode('public.t')::text AS f`,
    )
  )[0]!.f;

test.each(cases)(
  '%s to %s: we say rewrites=%s',
  async (from, to, value, rewrites) => {
    expect(typeChangeRewritesTable(await typeOf(from), await typeOf(to))).toBe(
      rewrites,
    );

    await pg.query(
      `DROP TABLE IF EXISTS public.t; CREATE TABLE public.t (c ${from}); INSERT INTO public.t VALUES (${value})`,
    );
    const before = await filenode();
    await pg.query(`ALTER TABLE public.t ALTER COLUMN c TYPE ${to}`);
    const rewrote = (await filenode()) !== before;

    // What matters is that "no rewrite" is never claimed for a change that does rewrite. A change we
    // call a rewrite may or may not be one (a length check can scan without rewriting); that only costs a warning.
    if (!rewrites) expect(rewrote).toBe(false);
  },
);

import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  classifyTypeChange,
  type TypeChangeRisk,
} from '../src/risk/type-changes';
import { parsePgType } from '../src/sql/pgtype';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

/** [from, to, a value that stresses the change, what we expect the classifier to say] */
const cases: [string, string, string, TypeChangeRisk][] = [
  ['smallint', 'integer', '32767', 'safe'],
  ['integer', 'bigint', '2147483647', 'safe'],
  ['smallint', 'bigint', '-32768', 'safe'],
  ['varchar(10)', 'varchar(20)', `'0123456789'`, 'safe'],
  ['varchar(10)', 'varchar', `'0123456789'`, 'safe'],
  ['varchar(10)', 'text', `'0123456789'`, 'safe'],
  ['text', 'varchar', `'a long piece of text'`, 'safe'],
  ['numeric(10,2)', 'numeric(12,2)', '12345678.90', 'safe'],
  ['numeric(10,2)', 'numeric(10,1)', '1.25', 'lossy'],
  ['real', 'integer', '1.5', 'lossy'],
  ['double precision', 'bigint', '2.7', 'lossy'],
  ['timestamp', 'date', `'2026-10-24 13:45:00'`, 'lossy'],
  ['timestamptz', 'date', `'2026-10-24 13:45:00+00'`, 'lossy'],
  ['text', 'varchar(3)', `'abcdef'`, 'lossy'],
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

test.each(cases)(
  '%s to %s, holding %s: the classifier says %s, and Postgres agrees',
  async (from, to, value, expected) => {
    expect(classifyTypeChange(await typeOf(from), await typeOf(to))).toBe(
      expected,
    );

    await pg.query(
      `DROP TABLE IF EXISTS public.t; CREATE TABLE public.t (c ${from}); INSERT INTO public.t VALUES (${value})`,
    );
    const before = (
      await pg.query<{ v: string }>('SELECT c::text AS v FROM public.t')
    )[0]!.v;
    let failed = false;
    try {
      // a string source needs no USING to go to a string; none of these cases need one otherwise
      await pg.query(`ALTER TABLE public.t ALTER COLUMN c TYPE ${to}`);
    } catch {
      failed = true;
    }
    const after = failed
      ? before
      : (await pg.query<{ v: string }>('SELECT c::text AS v FROM public.t'))[0]!
          .v;

    if (expected === 'safe') {
      expect(failed).toBe(false);
      expect(after).toBe(before); // every value is kept as it was
    } else {
      expect(failed || after !== before).toBe(true); // a value is cut, rounded or refused
    }
  },
);

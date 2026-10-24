import { afterAll, beforeAll, expect, test } from 'vitest';
import { introspectEnums } from '../src/introspect/enums';
import { enumId, schemaId } from '../src/model/ids';
import { oidOf, startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE SCHEMA app;
    CREATE TYPE public.mood AS ENUM ('sad', 'happy');
    ALTER TYPE public.mood ADD VALUE 'ok' BEFORE 'happy';
    ALTER TYPE public.mood ADD VALUE 'ecstatic';
    ALTER TYPE public.mood ADD VALUE 'grumpy' BEFORE 'sad';
    CREATE TYPE app.mood AS ENUM ('a');
    CREATE TYPE public."Odd Name" AS ENUM ('with space', 'it''s', 'Ünï');
    CREATE TYPE public.empty_enum AS ENUM ();
    CREATE DOMAIN public.posint AS integer;
    CREATE TYPE public.pair AS (a int, b int);
    CREATE EXTENSION pg_trgm;
    CREATE TYPE public.ext_enum AS ENUM ('x');
    ALTER EXTENSION pg_trgm ADD TYPE public.ext_enum;
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const enums = () => introspectEnums(pg.query);

test('labels are returned in enumsortorder, not creation order', async () => {
  const mood = (await enums()).find(
    (e) => e.name === 'mood' && e.labels.length > 1,
  )!;
  expect(mood.labels).toEqual(['grumpy', 'sad', 'ok', 'happy', 'ecstatic']);
});

test('the same enum name in two schemas gives two enums with the right schema ids', async () => {
  const moods = (await enums()).filter((e) => e.name === 'mood');
  expect(moods).toHaveLength(2);
  const app = await oidOf(
    pg.query,
    `(SELECT oid FROM pg_namespace WHERE nspname = 'app')`,
  );
  expect(moods.find((e) => e.labels.join() === 'a')!.schemaId).toBe(
    schemaId(app),
  );
});

test('labels with spaces, quotes and unicode survive; an empty enum has no labels', async () => {
  const all = await enums();
  expect(all.find((e) => e.name === 'Odd Name')!.labels).toEqual([
    'with space',
    "it's",
    'Ünï',
  ]);
  expect(all.find((e) => e.name === 'empty_enum')!.labels).toEqual([]);
});

test('ids come from the type oid', async () => {
  const oid = await oidOf(pg.query, `'public."Odd Name"'::regtype::oid`);
  expect((await enums()).find((e) => e.name === 'Odd Name')!.id).toBe(
    enumId(oid),
  );
});

test('domains, composite types and extension-owned enums are not returned', async () => {
  const names = (await enums()).map((e) => e.name);
  for (const excluded of ['posint', 'pair', 'ext_enum'])
    expect(names).not.toContain(excluded);
});

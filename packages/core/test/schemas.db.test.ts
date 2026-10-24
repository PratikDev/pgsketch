import { afterAll, beforeAll, expect, test } from 'vitest';
import { schemaId } from '../src/model/ids';
import { introspectSchemas } from '../src/introspect/schemas';
import { oidOf, startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE SCHEMA app;
    CREATE SCHEMA "My Schema";
    CREATE SCHEMA ext_schema;
    CREATE EXTENSION pg_trgm;
    ALTER EXTENSION pg_trgm ADD SCHEMA ext_schema;
    CREATE TEMP TABLE temp_probe (a int);
    CREATE TABLE app.t (big text);
  `);
  // a table with a TOAST table, so pg_toast exists with content
  await pg.query(`INSERT INTO app.t SELECT repeat('x', 10000)`);
});

afterAll(async () => {
  await pg?.stop();
});

test('user schemas are returned with names and ids', async () => {
  const schemas = await introspectSchemas(pg.query);
  expect(schemas.map((s) => s.name)).toEqual(['My Schema', 'app', 'public']);
  const oid = await oidOf(
    pg.query,
    `(SELECT oid FROM pg_namespace WHERE nspname = 'app')`,
  );
  expect(schemas.find((s) => s.name === 'app')!.id).toBe(schemaId(oid));
});

test('system, toast and temp schemas are excluded', async () => {
  const names = (await introspectSchemas(pg.query)).map((s) => s.name);
  const all = await pg.query<{ nspname: string }>(
    'SELECT nspname FROM pg_namespace',
  );
  // the database really has those schemas, we just must not return them
  expect(all.some((r) => r.nspname === 'pg_catalog')).toBe(true);
  expect(all.some((r) => r.nspname === 'information_schema')).toBe(true);
  expect(all.some((r) => r.nspname.startsWith('pg_toast'))).toBe(true);
  expect(all.some((r) => r.nspname.startsWith('pg_temp_'))).toBe(true);
  expect(
    names.filter((n) => n.startsWith('pg_') || n === 'information_schema'),
  ).toEqual([]);
});

test('schemas owned by an extension are excluded', async () => {
  expect((await introspectSchemas(pg.query)).map((s) => s.name)).not.toContain(
    'ext_schema',
  );
});

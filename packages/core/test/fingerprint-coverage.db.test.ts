import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  catalogsRead,
  FINGERPRINT_SQL,
  uncoveredCatalogs,
} from '../src/fingerprint/fingerprint';
import { introspectModel } from '../src/introspect';
import { withSnapshot, type Query } from '../src/introspect/query';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;
let catalogs: string[];

beforeAll(async () => {
  pg = await startPostgres();
  const rows = await pg.query<{ relname: string }>(
    `SELECT relname FROM pg_class WHERE relnamespace = 'pg_catalog'::regnamespace AND relkind = 'r' ORDER BY 1`,
  );
  catalogs = rows.map((r) => r.relname);
});

afterAll(async () => {
  await pg?.stop();
});

/** The SQL introspection actually runs, captured while it runs. */
async function introspectionSql(): Promise<string[]> {
  const seen: string[] = [];
  const spy: Query = (sql, params) => {
    seen.push(sql);
    return pg.query(sql, params);
  };
  await withSnapshot(pg.query, () => introspectModel(spy));
  return seen;
}

test('the database lists its real catalog tables', () => {
  expect(catalogs.length).toBeGreaterThan(50);
  expect(catalogs).toEqual(
    expect.arrayContaining([
      'pg_class',
      'pg_constraint',
      'pg_policy',
      'pg_depend',
    ]),
  );
});

test('every catalog table introspection reads is covered by the fingerprint', async () => {
  const sql = await introspectionSql();
  const read = catalogsRead(sql, catalogs);
  // a sanity floor, so this can't pass by finding nothing
  expect(read).toEqual(
    expect.arrayContaining([
      'pg_namespace',
      'pg_class',
      'pg_attribute',
      'pg_attrdef',
      'pg_constraint',
      'pg_index',
      'pg_am',
      'pg_opclass',
      'pg_enum',
      'pg_type',
      'pg_trigger',
      'pg_proc',
      'pg_policy',
      'pg_depend',
      'pg_rewrite',
    ]),
  );
  expect(uncoveredCatalogs(sql, FINGERPRINT_SQL, catalogs)).toEqual([]);
});

test('the guard fails when the fingerprint stops mentioning a catalog introspection reads', async () => {
  const sql = await introspectionSql();
  const broken = FINGERPRINT_SQL.replaceAll('pg_policy', 'pg_poli_cy');
  expect(uncoveredCatalogs(sql, broken, catalogs)).toEqual(['pg_policy']);
});

test('the guard flags a catalog read by a new query, and ignores functions like pg_get_expr', () => {
  const read = [
    'SELECT pg_get_expr(adbin, adrelid), obj_description(oid) FROM pg_class JOIN pg_publication p ON true',
  ];
  expect(uncoveredCatalogs(read, 'SELECT 1 FROM pg_class', catalogs)).toEqual([
    'pg_publication',
  ]);
  expect(
    catalogsRead(['SELECT pg_get_expr(1), pg_class_x, xpg_class'], catalogs),
  ).toEqual([]);
});

test('cast data is not fingerprinted', () => {
  expect(catalogsRead([FINGERPRINT_SQL], catalogs)).not.toContain('pg_cast');
});

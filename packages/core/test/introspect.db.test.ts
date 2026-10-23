import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fingerprint, FINGERPRINT_SQL } from '../src/fingerprint/fingerprint';
import { introspect } from '../src/introspect';
import type { Query } from '../src/introspect/query';
import { describeModel } from './describe-model';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(
    readFileSync(new URL('./fixtures/basic.sql', import.meta.url), 'utf8'),
  );
});

afterAll(async () => {
  await pg?.stop();
});

test('a snapshot of fixtures/basic.sql: two schemas, cross-schema FK, enum, view', async () => {
  const { model } = await introspect(pg.query);
  expect(describeModel(model)).toMatchSnapshot();
});

test('the result carries cast data and a fingerprint', async () => {
  const { casts, fingerprint: value } = await introspect(pg.query);
  expect(value).toMatch(/^[0-9a-f]{32}$/);
  expect(casts.categories.text).toBe('S');
  expect(casts.casts['integer>bigint']).toBe('i');
});

test('the fingerprint is read in the same transaction as the model, after the model queries', async () => {
  const seen: string[] = [];
  const spy: Query = (sql, params) => {
    seen.push(sql);
    return pg.query(sql, params);
  };
  await introspect(spy);
  const begin = seen.findIndex((s) =>
    s.startsWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'),
  );
  const commit = seen.indexOf('COMMIT');
  const fp = seen.indexOf(FINGERPRINT_SQL);
  expect(begin).toBe(0);
  expect(fp).toBeGreaterThan(begin);
  expect(fp).toBeLessThan(commit);
  expect(
    seen.filter((s) => s === 'COMMIT' || s.startsWith('BEGIN')),
  ).toHaveLength(2);
});

test('it describes one moment: a table created mid-introspection is in neither the model nor the fingerprint', async () => {
  await pg.query(`SET search_path = ''`);
  const before = await fingerprint(pg.query);
  const other = new Client({ connectionString: pg.connectionUri });
  await other.connect();
  try {
    let created = false;
    const racing: Query = async (sql, params) => {
      const rows = await pg.query<never>(sql, params);
      if (!created && sql.includes('FROM pg_namespace')) {
        created = true;
        await other.query('CREATE TABLE public.late (a int)');
      }
      return rows;
    };
    const result = await introspect(racing);
    expect(created).toBe(true);
    expect(Object.values(result.model.tables).map((t) => t.name)).not.toContain(
      'late',
    );
    expect(result.fingerprint).toBe(before);
    expect(await fingerprint(pg.query)).not.toBe(before);
    // a later introspection sees the table, and its fingerprint matches a standalone read
    const later = await introspect(pg.query);
    expect(Object.values(later.model.tables).map((t) => t.name)).toContain(
      'late',
    );
    expect(later.fingerprint).toBe(await fingerprint(pg.query));
  } finally {
    await other.end();
  }
});

test('a failure rolls the snapshot back and leaves the connection usable', async () => {
  let calls = 0;
  const failing: Query = (sql, params) => {
    if (sql.includes('FROM pg_enum') && ++calls === 1)
      return Promise.reject(new Error('boom'));
    return pg.query(sql, params);
  };
  await expect(introspect(failing)).rejects.toThrow('boom');
  expect(await pg.query('SHOW transaction_isolation')).toEqual([
    { transaction_isolation: 'read committed' },
  ]);
});

test('an empty database has only the public schema', async () => {
  await pg.query('CREATE DATABASE empty_db');
  const client = new Client({
    connectionString: pg.connectionUri.replace(/\/[^/]*$/, '/empty_db'),
  });
  await client.connect();
  try {
    const query: Query = async (sql, params) =>
      (await client.query(sql, params ? [...params] : undefined)).rows;
    const { model } = await introspect(query);
    expect(describeModel(model)).toEqual({
      schemas: ['public'],
      tables: [],
      enums: [],
      unmodeled: [],
    });
  } finally {
    await client.end();
  }
});

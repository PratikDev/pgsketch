import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { introspect } from '../src/introspect';
import type { Query } from '../src/introspect/query';
import type { PgType } from '../src/model/types';
import {
  currentSearchPath,
  normalizeExpression,
  type ExpressionColumn,
  type ExpressionContext,
} from '../src/normalize/expression';
import { quoteIdent } from '../src/sql/quote';
import { extendedQuery, startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;
let searchPath: string;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE EXTENSION "uuid-ossp";
    CREATE TYPE public.mood AS ENUM ('happy', 'sad');
    CREATE TABLE public.victim (id int);
    CREATE TABLE public.calls (n int);
    CREATE FUNCTION public.bump() RETURNS int LANGUAGE plpgsql
      AS $$ BEGIN INSERT INTO public.calls VALUES (1); RETURN 1; END $$;
    CREATE TABLE public.real (
      a timestamptz DEFAULT CURRENT_TIMESTAMP,
      b timestamptz DEFAULT now(),
      c text DEFAULT 'active',
      d uuid DEFAULT uuid_generate_v4(),
      e public.mood DEFAULT 'happy'
    );
  `);
  searchPath = await currentSearchPath(pg.singleQuery);
});

afterAll(async () => {
  await pg?.stop();
});

const type = (name: string, schema?: string): PgType => ({
  name,
  ...(schema && { schema }),
  isArray: false,
});
const column = (id: string, name: string, t: PgType): ExpressionColumn => ({
  id,
  name,
  type: t,
});
const context = (...columns: ExpressionColumn[]): ExpressionContext => ({
  columns,
  searchPath,
});
const one = (id: string, t: PgType) => context(column(id, 'x', t));

const normalizeDefault = (expression: string, t: PgType) =>
  normalizeExpression(
    pg.singleQuery,
    expression,
    { kind: 'default', columnId: 'x' },
    one('x', t),
  );

const expressionOf = async (expression: string, t: PgType) => {
  const result = await normalizeDefault(expression, t);
  if (result.status !== 'normalized') throw new Error(JSON.stringify(result));
  return result.expression;
};

test('the same expression typed differently normalizes alike, and as the table itself stores it', async () => {
  const stored = Object.fromEntries(
    Object.values((await introspect(pg.query)).model.columns)
      .filter((c) => c.tableId.startsWith('t:') && c.name.length === 1)
      .map((c) => [c.name, c.default?.expression]),
  );
  const timestamptz = type('timestamptz');
  for (const typed of [
    'CURRENT_TIMESTAMP',
    'current_timestamp',
    '  Current_Timestamp ',
  ]) {
    expect(await expressionOf(typed, timestamptz)).toBe('CURRENT_TIMESTAMP');
  }
  for (const typed of ['now()', 'NOW()', 'now ( )']) {
    expect(await expressionOf(typed, timestamptz)).toBe('now()');
  }
  expect(stored.a).toBe('CURRENT_TIMESTAMP');
  expect(stored.b).toBe('now()');
  expect(await expressionOf("'active'", type('text'))).toBe("'active'::text");
  expect(stored.c).toBe("'active'::text");
  expect(await expressionOf("'happy'", type('mood', 'public'))).toBe(
    "'happy'::public.mood",
  );
  expect(stored.e).toBe("'happy'::public.mood");
});

test('an unqualified function from an extension comes back qualified', async () => {
  expect(await expressionOf('uuid_generate_v4()', type('uuid'))).toBe(
    'public.uuid_generate_v4()',
  );
  expect(await expressionOf('public.uuid_generate_v4()', type('uuid'))).toBe(
    'public.uuid_generate_v4()',
  );
  // the same name read with an empty search path doesn't resolve: that is why the user's is used
  const none = await normalizeExpression(
    pg.singleQuery,
    'uuid_generate_v4()',
    { kind: 'default', columnId: 'x' },
    { ...one('x', type('uuid')), searchPath: '' },
  );
  expect(none).toMatchObject({ status: 'invalid' });
});

test('a check can use other columns of the table, and says which', async () => {
  const ctx = context(
    column('c:1', 'id', type('integer')),
    column('c:2', 'start_date', type('date')),
    column('c:3', 'end_date', type('date')),
  );
  expect(
    await normalizeExpression(
      pg.singleQuery,
      'end_date > start_date',
      { kind: 'check' },
      ctx,
    ),
  ).toEqual({
    status: 'normalized',
    expression: '(end_date > start_date)',
    columnIds: ['c:3', 'c:2'], // in the order the expression uses them
  });
  expect(
    await normalizeExpression(pg.singleQuery, 'id > 0', { kind: 'check' }, ctx),
  ).toMatchObject({ expression: '(id > 0)', columnIds: ['c:1'] });
  // pending columns count too: the context is what the editor holds, not what the database has
  const pending = context(column('new-1', 'brand_new', type('integer')));
  expect(
    await normalizeExpression(
      pg.singleQuery,
      'brand_new < 10',
      { kind: 'check' },
      pending,
    ),
  ).toMatchObject({ columnIds: ['new-1'] });
});

test('a check is stored the way introspection reads it back', async () => {
  await pg.query(`CREATE TABLE public.checked (s date, e date, CHECK (e > s))`);
  const { model } = await introspect(pg.query);
  const check = Object.values(model.constraints).find(
    (c) => c.kind === 'check' && c.name === 'checked_check',
  );
  const result = await normalizeExpression(
    pg.singleQuery,
    'e > s',
    { kind: 'check' },
    context(column('s', 's', type('date')), column('e', 'e', type('date'))),
  );
  expect(check).toMatchObject({ expression: '(e > s)' });
  expect(result).toMatchObject({
    expression: '(e > s)',
    columnIds: ['e', 's'],
  });
  // introspection lists a check's columns in the same order
  const stored = await pg.query<{ names: string[] }>(
    `SELECT ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k (n, o)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n
                   ORDER BY k.o) AS names
       FROM pg_constraint c WHERE c.conname = 'checked_check'`,
  );
  expect(stored[0]!.names).toEqual(['e', 's']);
  expect(check!.columnIds.map((id) => id.split(':')[2])).toEqual(['2', '1']);
});

test('mistakes come back as a message from Postgres', async () => {
  const integer = type('integer');
  expect(await normalizeDefault('1 +', integer)).toMatchObject({
    status: 'invalid',
    message: expect.stringContaining('syntax error'),
  });
  expect(await normalizeDefault("'abc'", integer)).toMatchObject({
    status: 'invalid',
    message: expect.stringContaining('invalid input syntax for type integer'),
  });
  expect(await normalizeDefault('', integer)).toMatchObject({
    status: 'invalid',
  });
  expect(
    await normalizeExpression(
      pg.singleQuery,
      'nope > 1',
      { kind: 'check' },
      one('x', integer),
    ),
  ).toMatchObject({
    status: 'invalid',
    message: expect.stringContaining('"nope"'),
  });
  // a default can't read the row it is a default of
  expect(
    await normalizeExpression(
      pg.singleQuery,
      'other + 1',
      { kind: 'default', columnId: 'x' },
      context(column('x', 'x', integer), column('o', 'other', integer)),
    ),
  ).toMatchObject({ status: 'invalid' });
});

const INJECTED = {
  asDefault: '1; COMMIT; DROP TABLE public.victim',
  asCheck: 'true); COMMIT; DROP TABLE public.victim; --',
};

const runInjected = (query: Query) => [
  normalizeExpression(
    query,
    INJECTED.asDefault,
    { kind: 'default', columnId: 'x' },
    one('x', type('integer')),
  ),
  normalizeExpression(
    query,
    INJECTED.asCheck,
    { kind: 'check' },
    one('x', type('integer')),
  ),
];

const tableName = async (name: string) =>
  (
    await pg.query<{ t: string | null }>(
      `SELECT to_regclass('public.${name}')::text AS t`,
    )
  )[0]!.t;
const victimExists = async () => (await tableName('victim')) === 'victim';

test('more statements in the expression fail instead of running', async () => {
  const results = await Promise.all(
    runInjected(pg.singleQuery).map(async (r) => r),
  );
  expect(results.map((r) => r.status)).toEqual(['invalid', 'invalid']);
  expect(await victimExists()).toBe(true);
});

test('which is the extended protocol at work: sent in the simple one, the same text runs', async () => {
  await pg.query('CREATE TABLE public.victim_control (id int)');
  // its own connection: the injected COMMIT leaves the temporary table behind
  const other = new Client({ connectionString: pg.connectionUri });
  await other.connect();
  try {
    await normalizeExpression(
      async (sql, params) =>
        (await other.query(sql, params ? [...params] : undefined)).rows,
      INJECTED.asDefault.replace('victim', 'victim_control'),
      { kind: 'default', columnId: 'x' },
      one('x', type('integer')),
    ).catch(() => undefined);
  } finally {
    await other.end();
  }
  expect(await tableName('victim_control')).toBeNull();
});

test('nothing in the expression is run, and nothing is left behind', async () => {
  const integer = type('integer');
  expect(await normalizeDefault('public.bump()', integer)).toMatchObject({
    status: 'normalized',
    expression: 'public.bump()',
  });
  expect(
    await normalizeExpression(
      pg.singleQuery,
      'public.bump() > 0',
      { kind: 'check' },
      one('x', integer),
    ),
  ).toMatchObject({ status: 'normalized' });
  expect(await pg.query('SELECT count(*)::int AS n FROM public.calls')).toEqual(
    [{ n: 0 }],
  );
  expect(
    await pg.query(
      `SELECT to_regclass('pg_temp.pgsketch_expression')::text AS t`,
    ),
  ).toEqual([{ t: null }]);
  // the connection is back outside a transaction, so an invalid expression doesn't poison the next one
  expect(await pg.query('SELECT txid_current_if_assigned() AS id')).toEqual([
    { id: null },
  ]);
  expect(await normalizeDefault('1 +', integer)).toMatchObject({
    status: 'invalid',
  });
  expect(await normalizeDefault('1', integer)).toMatchObject({
    expression: '1',
  });
});

test('a role that cannot create temporary tables, or a read-only session, keeps the text as typed', async () => {
  const name = `notemp_${randomUUID().replaceAll('-', '')}`;
  const role = `role_${name}`;
  await pg.client.query(`CREATE DATABASE ${quoteIdent(name)}`);
  const url = new URL(pg.connectionUri);
  url.pathname = `/${name}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(
    `REVOKE TEMPORARY ON DATABASE ${quoteIdent(name)} FROM PUBLIC`,
  );
  await pg.client.query(
    `CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD 'test'`,
  );
  url.username = role;
  url.password = 'test';
  const restricted = new Client({ connectionString: url.toString() });
  await restricted.connect();
  try {
    const result = await normalizeExpression(
      extendedQuery(restricted),
      '  now()  ',
      { kind: 'default', columnId: 'x' },
      one('x', type('timestamptz')),
    );
    expect(result).toEqual({ status: 'raw', expression: 'now()' });
    // the same role still works for everything else on the connection
    expect(await extendedQuery(restricted)('SELECT 1 AS one')).toEqual([
      { one: 1 },
    ]);

    await admin.query('SET default_transaction_read_only = on');
    expect(
      await normalizeExpression(
        extendedQuery(admin),
        "'x'",
        { kind: 'default', columnId: 'x' },
        one('x', type('text')),
      ),
    ).toEqual({ status: 'raw', expression: "'x'" });
  } finally {
    await restricted.end();
    await admin.end();
    await pg.client.query(`DROP DATABASE ${quoteIdent(name)} WITH (FORCE)`);
    await pg.client.query(`DROP ROLE ${quoteIdent(role)}`);
  }
});

test('the search path is read as the connection has it', async () => {
  expect(searchPath).toBe('"$user", public');
  await pg.query(`SET search_path = app, public`);
  expect(await currentSearchPath(pg.singleQuery)).toBe('app, public');
  await pg.query(`RESET search_path`);
});

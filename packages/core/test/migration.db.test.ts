import { afterAll, beforeAll, expect, test } from 'vitest';
import { diff } from '../src/diff';
import { introspect } from '../src/introspect';
import { assignNames } from '../src/model/naming';
import type { Column, SchemaModel } from '../src/model/types';
import { renderMigration } from '../src/render/migration';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.users (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email text NOT NULL,
      age text,
      nick varchar(50),
      legacy int
    );
    CREATE TABLE app.orders (
      id int PRIMARY KEY,
      user_id bigint,
      total numeric(10,2) DEFAULT 0,
      status text,
      CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES app.users (id),
      CONSTRAINT orders_total_check CHECK (total >= 0)
    );
    CREATE INDEX orders_status_idx ON app.orders (status);
    CREATE INDEX orders_total_idx ON app.orders (total);
    CREATE TABLE app.junk (a int);
    INSERT INTO app.users (email, age, nick) VALUES ('a@x.com', '30', 'ann'), ('b@x.com', '41', 'bob');
    INSERT INTO app.orders VALUES (1, 1, 5, 'open');
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const column = (
  id: string,
  tableId: string,
  name: string,
  over: Partial<Column> = {},
): Column => ({
  id,
  tableId,
  name,
  position: 1,
  type: { name: 'text', isArray: false },
  notNull: false,
  default: null,
  identity: null,
  comment: null,
  ...over,
});

test('the whole migration runs on Postgres and leaves the database as edited', async () => {
  const { model: baseline, casts } = await introspect(pg.query);
  const find = <T extends { name: string; tableId?: string }>(
    items: Record<string, T>,
    name: string,
    table?: string,
  ) => {
    const tableId =
      table && Object.values(baseline.tables).find((t) => t.name === table)!.id;
    return Object.values(items).find(
      (i) => i.name === name && (!tableId || i.tableId === tableId),
    )!;
  };
  const desired: SchemaModel = structuredClone(baseline);
  const col = (table: string, name: string) =>
    desired.columns[find(baseline.columns, name, table).id]!;
  const tableId = (name: string) => find(baseline.tables, name).id;

  desired.tables[tableId('users')]!.name = 'people';
  col('users', 'email').name = 'mail';
  col('users', 'email').notNull = false;
  col('users', 'age').type = { name: 'integer', isArray: false }; // text -> integer needs USING
  col('users', 'nick').type = { name: 'varchar', params: [20], isArray: false }; // shorter, no USING
  delete desired.columns[find(baseline.columns, 'legacy', 'users').id];
  col('orders', 'status').notNull = true;
  col('orders', 'status').default = {
    kind: 'constant',
    expression: "'new'::text",
  };
  col('orders', 'total').default = null;
  desired.columns['new-created'] = column(
    'new-created',
    tableId('orders'),
    'created',
    {
      type: { name: 'timestamptz', isArray: false },
      notNull: true,
      default: { kind: 'expression', expression: 'now()' },
    },
  );
  desired.constraints['new-u'] = {
    id: 'new-u',
    tableId: tableId('users'),
    kind: 'unique',
    name: 'x',
    autoName: true,
    columnIds: [find(baseline.columns, 'email', 'users').id],
  };
  desired.constraints[find(baseline.constraints, 'orders_user_fk').id]!.name =
    'orders_owner_fk';
  delete desired.constraints[
    find(baseline.constraints, 'orders_total_check').id
  ];
  desired.indexes[find(baseline.indexes, 'orders_status_idx').id]!.name =
    'by_status';
  delete desired.indexes[find(baseline.indexes, 'orders_total_idx').id];
  desired.indexes['new-i'] = {
    id: 'new-i',
    tableId: tableId('orders'),
    name: 'x',
    autoName: true,
    unique: false,
    columnIds: [find(baseline.columns, 'user_id', 'orders').id],
  };
  delete desired.tables[tableId('junk')];
  delete desired.columns[find(baseline.columns, 'a', 'junk').id];
  desired.tables[tableId('orders')]!.comment = 'Customer orders';
  col('orders', 'total').comment = 'Amount "gross"';
  // a new schema with a new table that references people
  desired.schemas.rep = { id: 'rep', name: 'reporting' };
  desired.tables['new-t'] = {
    id: 'new-t',
    schemaId: 'rep',
    name: 'audit',
    comment: null,
  };
  desired.columns['new-id'] = column('new-id', 'new-t', 'id', {
    type: { name: 'bigint', isArray: false },
    identity: 'always',
    notNull: true,
  });
  desired.columns['new-uid'] = column('new-uid', 'new-t', 'user_id', {
    type: { name: 'bigint', isArray: false },
  });
  desired.constraints['new-pk'] = {
    id: 'new-pk',
    tableId: 'new-t',
    kind: 'pk',
    name: 'x',
    autoName: true,
    columnIds: ['new-id'],
  };
  desired.constraints['new-fk'] = {
    id: 'new-fk',
    tableId: 'new-t',
    kind: 'fk',
    name: 'x',
    autoName: true,
    columnIds: ['new-uid'],
    refTableId: tableId('users'),
    refColumnIds: [find(baseline.columns, 'id', 'users').id],
    onDelete: 'cascade',
    onUpdate: 'no action',
  };

  const named = assignNames(desired);
  const { ops, errors } = diff(baseline, named);
  expect(errors).toEqual([]);
  const migration = renderMigration(ops, {
    baseline,
    desired: named,
    casts,
    generatedAt: 'test',
    dbName: 'test',
  });

  await pg.query(migration.text); // header, BEGIN, every statement, COMMIT, in one go

  const { model: after } = await introspect(pg.query);
  const names = <T extends { name: string }>(items: Record<string, T>) =>
    Object.values(items)
      .map((i) => i.name)
      .sort();
  const tablesIn = (schema: string) =>
    Object.values(after.tables)
      .filter(
        (t) =>
          Object.values(after.schemas).find((s) => s.id === t.schemaId)!
            .name === schema,
      )
      .map((t) => t.name)
      .sort();
  expect(tablesIn('app')).toEqual(['orders', 'people']);
  expect(tablesIn('reporting')).toEqual(['audit']);
  expect(names(after.indexes)).toEqual(['by_status', 'orders_user_id_idx']);
  expect(names(after.constraints)).toEqual([
    'audit_pkey',
    'audit_user_id_fkey',
    'orders_owner_fk',
    'orders_pkey',
    'people_mail_key',
    'users_pkey', // an existing name doesn't follow the table's rename
  ]);

  const age = Object.values(after.columns).find((c) => c.name === 'age')!;
  expect(age.type).toEqual({ name: 'integer', isArray: false });
  const people = await pg.query<{ mail: string; age: number }>(
    'SELECT mail, age FROM app.people ORDER BY mail',
  );
  expect(people).toEqual([
    { mail: 'a@x.com', age: 30 },
    { mail: 'b@x.com', age: 41 },
  ]); // data survived the USING
  expect(
    Object.values(after.columns).find((c) => c.name === 'nick')!.type,
  ).toEqual({ name: 'varchar', params: [20], isArray: false });
  expect(
    Object.values(after.columns).find((c) => c.name === 'status'),
  ).toMatchObject({ notNull: true, default: { expression: "'new'::text" } });
  expect(
    Object.values(after.columns).find((c) => c.name === 'total'),
  ).toMatchObject({ default: null, comment: 'Amount "gross"' });
  expect(Object.values(after.columns).some((c) => c.name === 'legacy')).toBe(
    false,
  );
  expect(
    Object.values(after.tables).find((t) => t.name === 'orders')!.comment,
  ).toBe('Customer orders');
  const fk = Object.values(after.constraints).find(
    (c) => c.name === 'audit_user_id_fkey',
  )!;
  expect(fk).toMatchObject({ kind: 'fk', onDelete: 'cascade' });
});

test('the same statements run one at a time, as Validate sends them', async () => {
  const { model: baseline, casts } = await introspect(pg.query);
  const desired: SchemaModel = structuredClone(baseline);
  desired.schemas.s2 = { id: 's2', name: 'extra' };
  const { ops } = diff(baseline, desired);
  const { statements } = renderMigration(ops, {
    baseline,
    desired,
    casts,
    generatedAt: 'x',
    dbName: 'x',
  });
  expect(statements).toEqual(['CREATE SCHEMA "extra"']);
  await pg.query('BEGIN');
  for (const statement of statements) await pg.query(statement);
  await pg.query('ROLLBACK');
  expect(
    await pg.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'extra'`),
  ).toEqual([]);
});

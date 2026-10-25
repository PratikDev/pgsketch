import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { applyEdits, type Edit } from './edits';
import { startPostgres, type TestPostgres } from './pg';
import { roundTrip } from './roundtrip';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

const SETUP = `
  CREATE SCHEMA app;
  CREATE TABLE app.users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    age integer,
    note text,
    nick varchar(50),
    created timestamptz DEFAULT now()
  );
  CREATE TABLE app.orders (
    id integer PRIMARY KEY,
    user_id bigint,
    total numeric(10,2) DEFAULT 0,
    status text,
    CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES app.users (id)
  );
  CREATE INDEX orders_status_idx ON app.orders (status);
  CREATE UNIQUE INDEX users_email_idx ON app.users (email);
  CREATE TABLE app.items (order_id integer REFERENCES app.orders (id), label text);
  CREATE TABLE app.loose (a integer, b integer, tag text DEFAULT 'x');
  INSERT INTO app.users (email, age, note, nick) VALUES ('a@x.com', 30, '7', 'ann'), ('b@x.com', 41, '9', 'bob');
  INSERT INTO app.orders VALUES (1, 1, 5, 'open');
  INSERT INTO app.items VALUES (1, 'first');
`;

const cases: [string, Edit[]][] = [
  [
    'a new schema with a table and an identity key',
    [
      { kind: 'addSchema', name: 'reporting' },
      {
        kind: 'addTable',
        table: 'reporting.audit',
        pk: ['id'],
        columns: [
          { name: 'id', type: 'bigint', identity: 'always' },
          { name: 'what', type: 'text', notNull: true },
        ],
      },
    ],
  ],
  [
    'a table with a composite key',
    [
      {
        kind: 'addTable',
        table: 'app.pairs',
        pk: ['a', 'b'],
        columns: [
          { name: 'a', type: 'integer' },
          { name: 'b', type: 'integer' },
          { name: 'c', type: 'numeric(8,3)', default: '0' },
        ],
      },
      {
        kind: 'setTableComment',
        table: 'app.pairs',
        comment: "Pairs of 'things'",
      },
    ],
  ],
  [
    'drop a table that others point at',
    [{ kind: 'dropTable', table: 'app.orders' }],
  ],
  [
    'drop tables that point at each other, in a chain',
    [
      { kind: 'dropTable', table: 'app.users' },
      { kind: 'dropTable', table: 'app.orders' },
      { kind: 'dropTable', table: 'app.items' },
    ],
  ],
  [
    'drop a table and create a new one with the same name',
    [
      { kind: 'dropTable', table: 'app.loose' },
      {
        kind: 'addTable',
        table: 'app.loose',
        pk: ['k'],
        columns: [{ name: 'k', type: 'text' }],
      },
    ],
  ],
  [
    'drop a column and add another with its name, then rename a third to the name of a dropped one',
    [
      { kind: 'dropColumn', table: 'app.loose', column: 'a' },
      {
        kind: 'addColumn',
        table: 'app.loose',
        column: { name: 'a', type: 'text' },
      },
      { kind: 'dropColumn', table: 'app.loose', column: 'b' },
      { kind: 'renameColumn', table: 'app.loose', column: 'tag', to: 'b' },
    ],
  ],
  [
    'drop a key column and the table whose foreign key points at it',
    [
      { kind: 'dropTable', table: 'app.items' },
      { kind: 'dropColumn', table: 'app.orders', column: 'id' },
    ],
  ],
  [
    'swap a primary key for a unique constraint while a foreign key points at it',
    [
      { kind: 'dropConstraint', table: 'app.orders', name: 'orders_pkey' },
      { kind: 'addUnique', table: 'app.orders', columns: ['id'] },
    ],
  ],
  ['drop a table with no key', [{ kind: 'dropTable', table: 'app.loose' }]],
  [
    'rename a table',
    [{ kind: 'renameTable', table: 'app.users', to: 'people' }],
  ],
  [
    'set and clear table comments',
    [
      { kind: 'setTableComment', table: 'app.users', comment: 'People' },
      { kind: 'setTableComment', table: 'app.loose', comment: null },
    ],
  ],
  [
    'add a nullable column',
    [
      {
        kind: 'addColumn',
        table: 'app.loose',
        column: { name: 'c', type: 'text' },
      },
    ],
  ],
  [
    'add a NOT NULL column with a default to a table with rows',
    [
      {
        kind: 'addColumn',
        table: 'app.users',
        column: {
          name: 'active',
          type: 'boolean',
          notNull: true,
          default: 'true',
        },
      },
    ],
  ],
  [
    'add an identity column',
    [
      {
        kind: 'addColumn',
        table: 'app.loose',
        column: {
          name: 'seq',
          type: 'integer',
          identity: 'byDefault',
        },
      },
    ],
  ],
  [
    'drop a column that has an index',
    [{ kind: 'dropColumn', table: 'app.orders', column: 'status' }],
  ],
  [
    'drop a column that a foreign key uses on both sides',
    [{ kind: 'dropColumn', table: 'app.orders', column: 'id' }],
  ],
  [
    'rename a column that has an index',
    [{ kind: 'renameColumn', table: 'app.users', column: 'email', to: 'mail' }],
  ],
  [
    'widen a column type',
    [{ kind: 'setType', table: 'app.loose', column: 'a', type: 'bigint' }],
  ],
  [
    'change text to integer, which needs USING, with rows',
    [{ kind: 'setType', table: 'app.users', column: 'note', type: 'integer' }],
  ],
  [
    'change a varchar length',
    [
      {
        kind: 'setType',
        table: 'app.users',
        column: 'nick',
        type: 'varchar(20)',
      },
    ],
  ],
  [
    'set and drop NOT NULL',
    [
      { kind: 'setNotNull', table: 'app.users', column: 'nick', notNull: true },
      {
        kind: 'setNotNull',
        table: 'app.users',
        column: 'email',
        notNull: false,
      },
    ],
  ],
  [
    'set and drop defaults',
    [
      {
        kind: 'setDefault',
        table: 'app.orders',
        column: 'status',
        default: "'new'::text",
      },
      {
        kind: 'setDefault',
        table: 'app.orders',
        column: 'total',
        default: null,
      },
      {
        kind: 'setDefault',
        table: 'app.users',
        column: 'created',
        default: 'now()',
      },
    ],
  ],
  [
    'set and clear column comments',
    [
      {
        kind: 'setColumnComment',
        table: 'app.users',
        column: 'email',
        comment: 'Login "name"',
      },
      {
        kind: 'setColumnComment',
        table: 'app.orders',
        column: 'total',
        comment: null,
      },
    ],
  ],
  [
    'add a unique constraint, an index and a foreign key',
    [
      { kind: 'addUnique', table: 'app.loose', columns: ['a', 'b'] },
      { kind: 'addIndex', table: 'app.users', columns: ['age', 'nick'] },
      { kind: 'addIndex', table: 'app.loose', columns: ['b'], unique: true },
      {
        kind: 'addForeignKey',
        table: 'app.loose',
        columns: ['a'],
        references: 'app.orders',
        referencedColumns: ['id'],
        onDelete: 'cascade',
      },
    ],
  ],
  [
    'drop a constraint and an index',
    [
      { kind: 'dropConstraint', table: 'app.orders', name: 'orders_user_fk' },
      { kind: 'dropIndex', index: 'app.orders_status_idx' },
    ],
  ],
  [
    'rename a constraint and an index',
    [
      {
        kind: 'renameConstraint',
        table: 'app.orders',
        name: 'orders_user_fk',
        to: 'orders_owner_fk',
      },
      { kind: 'renameIndex', index: 'app.users_email_idx', to: 'by_email' },
    ],
  ],
  [
    'change the type of a column whose old default cannot be cast, and drop the default',
    [
      { kind: 'setType', table: 'app.loose', column: 'tag', type: 'integer' },
      { kind: 'setDefault', table: 'app.loose', column: 'tag', default: null },
    ],
  ],
  [
    'change the type of a column whose old default cannot be cast, and set a new one',
    [
      { kind: 'setType', table: 'app.loose', column: 'tag', type: 'integer' },
      { kind: 'setDefault', table: 'app.loose', column: 'tag', default: '7' },
    ],
  ],
  [
    'change the type of a key and the column that points at it',
    [
      { kind: 'setType', table: 'app.orders', column: 'id', type: 'bigint' },
      {
        kind: 'setType',
        table: 'app.items',
        column: 'order_id',
        type: 'bigint',
      },
    ],
  ],
  [
    'rename a table and a column, change a type, add a foreign key to the renamed table',
    [
      { kind: 'renameTable', table: 'app.users', to: 'people' },
      {
        kind: 'renameColumn',
        table: 'app.people',
        column: 'nick',
        to: 'handle',
      },
      { kind: 'setType', table: 'app.people', column: 'age', type: 'bigint' },
      {
        kind: 'addForeignKey',
        table: 'app.loose',
        columns: ['a'],
        references: 'app.people',
        referencedColumns: ['id'],
      },
    ],
  ],
  [
    'a new schema with a table that points at an existing one',
    [
      { kind: 'addSchema', name: 'reporting' },
      {
        kind: 'addTable',
        table: 'reporting.audit',
        pk: ['id'],
        columns: [
          { name: 'id', type: 'bigint', identity: 'always' },
          { name: 'user_id', type: 'bigint' },
        ],
      },
      {
        kind: 'addForeignKey',
        table: 'reporting.audit',
        columns: ['user_id'],
        references: 'app.users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
      },
    ],
  ],
];

describe('round trip', () => {
  test.each(cases)(
    '%s',
    async (_, edits) => {
      const { difference, migration } = await roundTrip(pg, SETUP, (m) =>
        applyEdits(m, edits),
      );
      expect(difference, migration.text).toBeNull();
    },
    60_000,
  );

  test('there are at least 20 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });
});

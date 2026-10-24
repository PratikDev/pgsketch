import { afterAll, beforeAll, expect, test } from 'vitest';
import { introspect } from '../src/introspect';
import { renderSchemaOp } from '../src/render/schemas';
import { renderTableOp } from '../src/render/tables';
import type { ModelPair } from '../src/model/types';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.query(`CREATE TYPE public.mood AS ENUM ('happy')`);
});

afterAll(async () => {
  await pg?.stop();
});

const run = async (statements: string[]) => {
  for (const statement of statements) await pg.query(statement);
};
const empty = {
  schemas: {},
  tables: {},
  columns: {},
  constraints: {},
  indexes: {},
  enums: {},
  unmodeled: {},
};
const models: ModelPair = {
  baseline: {
    ...empty,
    tables: {
      'old-t': {
        id: 'old-t',
        schemaId: 's',
        name: 'My "Table"',
        comment: null,
      },
    },
  },
  desired: { ...empty, schemas: { s: { id: 's', name: 'Odd "Schema"' } } },
};

test('the rendered schema and table statements run, and introspection finds what they made', async () => {
  await run(
    renderSchemaOp({
      kind: 'createSchema',
      schema: { id: 's', name: 'Odd "Schema"' },
    }),
  );
  const col = (id: string, name: string, over = {}) => ({
    id,
    tableId: 'new-t',
    name,
    position: 1,
    type: { name: 'text', isArray: false },
    notNull: false,
    default: null,
    identity: null,
    comment: null,
    ...over,
  });
  await run(
    renderTableOp(
      {
        kind: 'createTable',
        table: {
          id: 'new-t',
          schemaId: 's',
          name: 'My "Table"',
          comment: null,
        },
        columns: [
          col('a', 'id', {
            type: { name: 'bigint', isArray: false },
            identity: 'always',
            notNull: true,
          }),
          col('b', 'order', { notNull: true }),
          col('c', 'age', {
            type: { name: 'integer', isArray: false },
            default: { kind: 'constant', expression: '18' },
          }),
          col('d', 'tags', { type: { name: 'text', isArray: true } }),
          col('e', 'feeling', {
            type: { name: 'mood', schema: 'public', isArray: false },
          }),
          col('f', 'name', {
            type: { name: 'varchar', params: [255], isArray: false },
          }),
        ],
        pk: {
          id: 'pk',
          tableId: 'new-t',
          kind: 'pk',
          name: 'my_pkey',
          columnIds: ['a'],
        },
      },
      models,
    ),
  );
  const { model } = await introspect(pg.query);
  const table = Object.values(model.tables).find(
    (t) => t.name === 'My "Table"',
  )!;
  const columns = Object.values(model.columns).filter(
    (c) => c.tableId === table.id,
  );
  expect(columns.map((c) => c.name)).toEqual([
    'id',
    'order',
    'age',
    'tags',
    'feeling',
    'name',
  ]);
  expect(columns.find((c) => c.name === 'id')).toMatchObject({
    identity: 'always',
    notNull: true,
    type: { name: 'bigint' },
  });
  expect(columns.find((c) => c.name === 'order')).toMatchObject({
    notNull: true,
  });
  expect(columns.find((c) => c.name === 'age')!.default!.expression).toBe('18');
  expect(columns.find((c) => c.name === 'tags')!.type).toEqual({
    name: 'text',
    isArray: true,
  });
  expect(columns.find((c) => c.name === 'feeling')!.type).toMatchObject({
    name: 'mood',
    schema: 'public',
  });
  expect(columns.find((c) => c.name === 'name')!.type).toEqual({
    name: 'varchar',
    params: [255],
    isArray: false,
  });
  const pk = Object.values(model.constraints).find(
    (c) => c.tableId === table.id && c.kind === 'pk',
  )!;
  expect(pk.name).toBe('my_pkey');
  expect(pk.columnIds).toEqual([columns.find((c) => c.name === 'id')!.id]);
});

test('rename and drop statements run', async () => {
  await run(
    renderTableOp(
      {
        kind: 'renameTable',
        tableId: 'old-t',
        from: 'My "Table"',
        to: 'Renamed',
      },
      models,
    ),
  );
  const afterRename = await pg.query<{ relname: string }>(
    `SELECT relname FROM pg_class WHERE relname IN ('My "Table"', 'Renamed')`,
  );
  expect(afterRename).toEqual([{ relname: 'Renamed' }]);
  await run(
    renderTableOp(
      {
        kind: 'dropTable',
        table: { id: 'old-t', schemaId: 's', name: 'Renamed', comment: null },
      },
      models,
    ),
  );
  expect(
    await pg.query(`SELECT 1 FROM pg_class WHERE relname = 'Renamed'`),
  ).toEqual([]);
});

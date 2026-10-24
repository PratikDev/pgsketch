import { describe, expect, test } from 'vitest';
import { diffTables } from '../src/diff/tables';
import type { Table } from '../src/model/types';
import { partRunner } from './diff-helpers';
import { fixtureModel } from './fixtures/model';

const run = partRunner(diffTables);

const newTable = (over: Partial<Table> = {}): Table => ({
  id: 'new-t',
  schemaId: 's:1',
  name: 'orders',
  comment: null,
  ...over,
});

test('no edits, no operations', () => {
  expect(run(() => {})).toEqual({ ops: [], errors: [] });
});

describe('create', () => {
  test('a new table yields createTable with its columns in order and its primary key', () => {
    const { ops } = run((m) => {
      m.tables['new-t'] = newTable();
      for (const [id, name, position] of [
        ['new-b', 'qty', 2],
        ['new-a', 'id', 1],
      ] as const) {
        m.columns[id] = {
          ...m.columns['c:10:1']!,
          id,
          tableId: 'new-t',
          name,
          position,
          identity: null,
        };
      }
      m.constraints['new-pk'] = {
        id: 'new-pk',
        tableId: 'new-t',
        kind: 'pk',
        name: 'orders_pkey',
        columnIds: ['new-a'],
      };
      m.constraints['new-ck'] = {
        id: 'new-ck',
        tableId: 'new-t',
        kind: 'check',
        name: 'c',
        columnIds: ['new-b'],
        expression: '(qty > 0)',
      };
    });
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.kind).toBe('createTable');
    if (op.kind !== 'createTable') return;
    expect(op.table.name).toBe('orders');
    expect(op.columns.map((c) => c.name)).toEqual(['id', 'qty']);
    expect(op.pk).toMatchObject({ id: 'new-pk', kind: 'pk' });
  });

  test('a new table without a primary key has no pk field', () => {
    const { ops } = run((m) => (m.tables['new-t'] = newTable()));
    expect(ops).toHaveLength(1);
    expect(ops[0]).not.toHaveProperty('pk');
  });
});

describe('rename', () => {
  test('a renamed table keeps its id and yields renameTable, not drop + create', () => {
    const { ops, errors } = run((m) => (m.tables['t:10']!.name = 'people'));
    expect(ops).toEqual([
      { kind: 'renameTable', tableId: 't:10', from: 'users', to: 'people' },
    ]);
    expect(errors).toEqual([]);
  });
});

describe('drop', () => {
  test('a removed table yields dropTable with the table as it was', () => {
    const { ops } = run((m) => delete m.tables['t:10']);
    expect(ops).toEqual([
      { kind: 'dropTable', table: fixtureModel.tables['t:10'] },
    ]);
  });

  test('a read-only table can be dropped: it is its own table being removed', () => {
    const { ops } = run((m) => delete m.tables['t:30']);
    expect(ops).toMatchObject([
      {
        kind: 'dropTable',
        table: { id: 't:30', readOnly: 'partitioned-table' },
      },
    ]);
  });
});

describe('moving an existing table', () => {
  test('is a blocking error and produces no operation', () => {
    const { ops, errors } = run((m) => (m.tables['t:10']!.schemaId = 's:2'));
    expect(ops).toEqual([]);
    expect(errors).toMatchObject([
      { code: 'table-schema-changed', objectId: 't:10' },
    ]);
  });

  test('renaming at the same time still reports the move', () => {
    const { ops, errors } = run((m) => {
      m.tables['t:10']!.schemaId = 's:2';
      m.tables['t:10']!.name = 'people';
    });
    expect(ops.map((o) => o.kind)).toEqual(['renameTable']);
    expect(errors).toHaveLength(1);
  });

  test('a pending table can be in any schema', () => {
    const { errors } = run(
      (m) => (m.tables['new-t'] = newTable({ schemaId: 's:2' })),
    );
    expect(errors).toEqual([]);
  });
});

test('create, rename and drop in one edit give one operation each', () => {
  const { ops } = run((m) => {
    m.tables['new-t'] = newTable();
    m.tables['t:10']!.name = 'people';
    delete m.tables['t:20'];
  });
  expect(ops.map((o) => o.kind).sort()).toEqual([
    'createTable',
    'dropTable',
    'renameTable',
  ]);
});

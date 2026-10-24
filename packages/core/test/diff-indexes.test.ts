import { describe, expect, test } from 'vitest';
import { diffIndexes } from '../src/diff/indexes';
import type { Index } from '../src/model/types';
import { editBoth, partRunner, opKinds, type Change } from './diff-helpers';
import { fixtureModel } from './fixtures/model';

const run = partRunner(diffIndexes);
const kinds = (change: Change) => opKinds(run(change));

const newIndex: Index = {
  id: 'new-i',
  tableId: 't:20',
  name: 'invoices_total_idx',
  unique: true,
  columnIds: ['c:20:3'],
};

test('no edits, no operations', () => {
  expect(run(() => {})).toEqual({ ops: [], errors: [] });
});

describe('add and drop', () => {
  test('a new index yields addIndex', () => {
    expect(run((m) => (m.indexes['new-i'] = newIndex)).ops).toEqual([
      { kind: 'addIndex', index: newIndex },
    ]);
  });

  test('a new index on a new table is added too: indexes are never part of createTable', () => {
    const { ops } = run((m) => {
      m.tables['new-t'] = {
        id: 'new-t',
        schemaId: 's:1',
        name: 'orders',
        comment: null,
      };
      m.indexes['new-i'] = { ...newIndex, tableId: 'new-t' };
    });
    expect(ops.map((o) => o.kind)).toEqual(['addIndex']);
  });

  test('a removed index yields dropIndex with the index as it was', () => {
    expect(run((m) => delete m.indexes['i:1']).ops).toEqual([
      { kind: 'dropIndex', index: fixtureModel.indexes['i:1'] },
    ]);
  });

  test('indexes of a dropped table go with it and get no operation', () => {
    const { ops } = run((m) => {
      delete m.tables['t:20'];
      delete m.indexes['i:1'];
      delete m.indexes['i:2'];
    });
    expect(ops).toEqual([]);
  });
});

describe('rename', () => {
  test('a renamed index keeps its id and yields renameIndex', () => {
    expect(run((m) => (m.indexes['i:1']!.name = 'by_user')).ops).toEqual([
      {
        kind: 'renameIndex',
        indexId: 'i:1',
        from: 'invoices_user_id_idx',
        to: 'by_user',
      },
    ]);
  });
});

describe('a changed index is dropped and added again', () => {
  const composite = (m: Change extends (d: infer D) => void ? D : never) =>
    (m.indexes['i:c'] = {
      id: 'i:c',
      tableId: 't:20',
      name: 'composite',
      unique: false,
      columnIds: ['c:20:2', 'c:20:3'],
    });

  test('a column order change yields drop + add', () => {
    const { baseline, desired } = editBoth(
      (m) => composite(m),
      (m) => (m.indexes['i:c']!.columnIds = ['c:20:3', 'c:20:2']),
    );
    const { ops } = diffIndexes(baseline, desired);
    expect(ops.map((o) => o.kind)).toEqual(['dropIndex', 'addIndex']);
    expect(ops[0]).toMatchObject({
      index: { columnIds: ['c:20:2', 'c:20:3'] },
    });
    expect(ops[1]).toMatchObject({
      index: { columnIds: ['c:20:3', 'c:20:2'] },
    });
  });

  test('toggling unique, or changing the columns, yields drop + add', () => {
    expect(kinds((m) => (m.indexes['i:1']!.unique = true))).toEqual([
      'dropIndex',
      'addIndex',
    ]);
    expect(kinds((m) => (m.indexes['i:1']!.columnIds = ['c:20:3']))).toEqual([
      'dropIndex',
      'addIndex',
    ]);
  });

  test('renaming and changing at once is drop + add, not a rename', () => {
    expect(
      kinds((m) => {
        m.indexes['i:1']!.name = 'other';
        m.indexes['i:1']!.unique = true;
      }),
    ).toEqual(['dropIndex', 'addIndex']);
  });
});

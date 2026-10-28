import { diff, type ChangeOp, type SchemaModel } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { fixtureModel as baseline } from '@/test-model';
import { statusMapOf } from './status';

/** The status map of an edit of the fixture, found the way the app finds it. */
function statuses(change: (desired: SchemaModel) => void) {
  const desired = structuredClone(baseline);
  change(desired);
  const { ops } = diff(baseline, desired);
  return statusMapOf(ops, baseline);
}

describe('modified', () => {
  test('a renamed column is modified, with its old name', () => {
    expect(statuses((d) => (d.columns['c:10:2']!.name = 'state'))).toEqual({
      'c:10:2': { status: 'modified', old: { name: 'status' } },
    });
  });

  test('a renamed table, constraint and index too', () => {
    const map = statuses((d) => {
      d.tables['t:10']!.name = 'people';
      d.constraints['k:3']!.name = 'positive_total';
      d.indexes['i:1']!.name = 'by_user';
    });
    expect(map).toEqual({
      't:10': { status: 'modified', old: { name: 'users' } },
      'k:3': { status: 'modified', old: { name: 'invoices_total_check' } },
      'i:1': { status: 'modified', old: { name: 'invoices_user_id_idx' } },
    });
  });

  test('a new type, nullability, default and comment each give the old value', () => {
    const map = statuses((d) => {
      d.columns['c:20:3']!.type = { name: 'bigint', isArray: false };
      d.columns['c:20:3']!.notNull = true;
      d.columns['c:20:3']!.default = null;
      d.columns['c:20:2']!.comment = 'Owner';
      d.tables['t:20']!.comment = null;
    });
    expect(map['c:20:3']).toEqual({
      status: 'modified',
      old: {
        type: 'numeric(10,2)',
        notNull: false,
        default: baseline.columns['c:20:3']!.default?.expression ?? null,
      },
    });
    expect(map['c:20:2']).toEqual({
      status: 'modified',
      old: { comment: null },
    });
    expect(map['t:20']).toEqual({
      status: 'modified',
      old: { comment: 'Issued invoices' },
    });
  });

  test('turning NOT NULL off remembers that it was on', () => {
    expect(
      statuses((d) => (d.columns['c:10:1']!.notNull = false))['c:10:1'],
    ).toEqual({
      status: 'modified',
      old: { notNull: true },
    });
  });

  test('a key that is dropped and added again is one modified object', () => {
    const map = statuses((d) => (d.constraints['k:3']!.columnIds = ['c:20:2']));
    expect(map['k:3']).toEqual({ status: 'modified', old: {} });
  });
});

describe('the PK and UQ badges', () => {
  const unique = (id: string, columnIds: string[]) => ({
    id,
    tableId: 't:20',
    kind: 'unique' as const,
    name: id,
    columnIds,
  });

  test('a unique constraint added on one column modifies that column', () => {
    const map = statuses(
      (d) => (d.constraints['k:u'] = unique('k:u', ['c:20:2'])),
    );
    expect(map['c:20:2']).toEqual({
      status: 'modified',
      old: { unique: false },
    });
    expect(map['k:u']?.status).toBe('added');
  });

  test('a unique constraint over several columns is not a UQ badge, so no column changes', () => {
    const map = statuses(
      (d) => (d.constraints['k:u'] = unique('k:u', ['c:20:2', 'c:20:3'])),
    );
    expect(Object.keys(map)).toEqual(['k:u']);
  });

  test('a primary key added modifies each column in it, and one dropped remembers it was there', () => {
    const added = statuses((d) => {
      d.constraints['k:pk'] = {
        id: 'k:pk',
        tableId: 't:20',
        kind: 'pk',
        name: 'k:pk',
        columnIds: ['c:20:1', 'c:20:2'],
      };
    });
    expect(added['c:20:1']?.old).toEqual({ primaryKey: false });
    expect(added['c:20:2']?.old).toEqual({ primaryKey: false });
    const dropped = statuses((d) => delete d.constraints['k:1']);
    expect(dropped['c:10:1']).toEqual({
      status: 'modified',
      old: { primaryKey: true },
    });
  });

  test('widening a key changes only the column that joined it', () => {
    const map = statuses((d) => {
      const key = d.constraints['k:1']!;
      key.columnIds = ['c:10:1', 'c:10:2'];
    });
    expect(map['c:10:1']).toBeUndefined();
    expect(map['c:10:2']).toEqual({
      status: 'modified',
      old: { primaryKey: false },
    });
  });
});

describe('added and removed', () => {
  test('a new table, its columns and its key are added', () => {
    const map = statuses((d) => {
      d.tables['new-t'] = {
        id: 'new-t',
        schemaId: 's:1',
        name: 'audit',
        comment: null,
      };
      d.columns['new-c'] = {
        id: 'new-c',
        tableId: 'new-t',
        name: 'id',
        position: 1,
        type: { name: 'bigint', isArray: false },
        notNull: true,
        default: null,
        identity: 'always',
        comment: null,
      };
      d.constraints['new-k'] = {
        id: 'new-k',
        tableId: 'new-t',
        kind: 'pk',
        name: 'x',
        autoName: true,
        columnIds: ['new-c'],
      };
      d.schemas['new-s'] = { id: 'new-s', name: 'extra' };
    });
    expect(
      Object.fromEntries(Object.entries(map).map(([id, s]) => [id, s.status])),
    ).toEqual({
      'new-t': 'added',
      'new-c': 'added',
      'new-k': 'added',
      'new-s': 'added',
    });
  });

  test('a new column, constraint and index on an existing table are added', () => {
    const map = statuses((d) => {
      d.columns['new-c'] = {
        ...d.columns['c:10:2']!,
        id: 'new-c',
        name: 'extra',
        position: 3,
      };
      d.indexes['new-i'] = {
        id: 'new-i',
        tableId: 't:10',
        name: 'x',
        autoName: true,
        unique: false,
        columnIds: ['c:10:2'],
      };
    });
    expect(map['new-c']).toEqual({ status: 'added', old: {} });
    expect(map['new-i']).toEqual({ status: 'added', old: {} });
  });

  test('a removed column, constraint and index are removed', () => {
    const map = statuses((d) => {
      delete d.columns['c:20:2'];
      delete d.constraints['k:2'];
      delete d.indexes['i:1'];
    });
    expect(
      Object.fromEntries(Object.entries(map).map(([id, s]) => [id, s.status])),
    ).toEqual({
      'c:20:2': 'removed',
      'k:2': 'removed',
      'i:1': 'removed',
    });
  });

  test('a removed table takes its columns, keys and indexes with it, and the foreign key from another table', () => {
    // without the view, which would stop the table being dropped
    const loaded = structuredClone(baseline);
    delete loaded.unmodeled['u:1'];
    const desired = structuredClone(loaded);
    delete desired.tables['t:10'];
    for (const [id, c] of Object.entries(desired.columns))
      if (c.tableId === 't:10') delete desired.columns[id];
    for (const [id, k] of Object.entries(desired.constraints))
      if (k.tableId === 't:10' || (k.kind === 'fk' && k.refTableId === 't:10'))
        delete desired.constraints[id];
    const map = statusMapOf(diff(loaded, desired).ops, loaded);
    expect(map['t:10']?.status).toBe('removed');
    for (const id of ['c:10:1', 'c:10:2', 'k:1', 'k:2'])
      expect(map[id]?.status, id).toBe('removed');
    expect(map['t:20']).toBeUndefined();
  });
});

describe('the map', () => {
  test('is empty for no changes, and has only changed objects', () => {
    expect(statusMapOf([], baseline)).toEqual({});
    expect(
      Object.keys(statuses((d) => (d.columns['c:10:2']!.name = 'state'))),
    ).toEqual(['c:10:2']);
  });

  test('knows every kind of operation, and gives each object one status', () => {
    const ops: ChangeOp[] = [
      { kind: 'setNotNull', columnId: 'c:10:1' },
      { kind: 'renameColumn', columnId: 'c:10:1', from: 'id', to: 'uid' },
    ];
    expect(statusMapOf(ops, baseline)['c:10:1']).toEqual({
      status: 'modified',
      old: { notNull: false, name: 'id' },
    });
  });
});

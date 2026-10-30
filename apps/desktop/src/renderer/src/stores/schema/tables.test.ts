import { assignNames, diff, validateModel } from '@pgsketch/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { createSchemaStore } from '.';

const casts = { categories: {}, domains: {}, casts: {} };
let store: ReturnType<typeof createSchemaStore>;

beforeEach(() => {
  store = createSchemaStore();
  store.getState().load({ model: fixtureModel, casts, fingerprint: 'f' });
});

const ops = () => {
  const { baseline, desired } = store.getState();
  return diff(baseline, assignNames(desired));
};
const opKinds = () =>
  ops()
    .ops.map((o) => o.kind)
    .sort();

describe('setTableComment', () => {
  test('sets and clears the comment of a table, each as one setComment', () => {
    store.getState().setTableComment('t:10', 'People');
    expect(store.getState().desired.tables['t:10']!.comment).toBe('People');
    expect(opKinds()).toEqual(['setComment']);
    store.getState().setTableComment('t:10', null);
    expect(store.getState().desired.tables['t:10']!.comment).toBeNull();
    expect(opKinds()).toEqual([]);
  });

  test('ignores a table that is not there', () => {
    store.getState().setTableComment('nope', 'x');
    expect(opKinds()).toEqual([]);
  });
});

describe('addTable', () => {
  test('a new table starts with an id bigint identity primary key', () => {
    const id = store.getState().addTable('s:1');
    const { desired } = store.getState();
    expect(desired.tables[id]).toMatchObject({
      schemaId: 's:1',
      name: 'new_table',
      comment: null,
    });
    const columns = Object.values(desired.columns).filter(
      (c) => c.tableId === id,
    );
    expect(columns).toEqual([
      expect.objectContaining({
        name: 'id',
        position: 1,
        notNull: true,
        default: null,
        identity: 'always',
        type: { name: 'bigint', isArray: false },
      }),
    ]);
    const keys = Object.values(desired.constraints).filter(
      (c) => c.tableId === id,
    );
    expect(keys).toEqual([
      expect.objectContaining({
        kind: 'pk',
        autoName: true,
        columnIds: [columns[0]!.id],
      }),
    ]);
  });

  test('it is a pending table: a random id, one createTable with its key, and no validation errors', () => {
    const id = store.getState().addTable('s:1');
    expect(fixtureModel.tables[id]).toBeUndefined();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(opKinds()).toEqual(['createTable']);
    const create = ops().ops[0];
    expect(create).toMatchObject({
      kind: 'createTable',
      columns: [{ name: 'id' }],
      pk: { kind: 'pk' },
    });
    expect(validateModel(assignNames(store.getState().desired))).toEqual([]);
  });

  test('names do not collide: new_table, new_table_2, new_table_3, per schema', () => {
    const a = store.getState().addTable('s:1');
    const b = store.getState().addTable('s:1');
    const c = store.getState().addTable('s:1');
    const other = store.getState().addTable('s:2');
    const names = (ids: string[]) =>
      ids.map((i) => store.getState().desired.tables[i]!.name);
    expect(names([a, b, c, other])).toEqual([
      'new_table',
      'new_table_2',
      'new_table_3',
      'new_table',
    ]);
  });

  test('each call is an edit', () => {
    store.getState().addTable('s:1');
    store.getState().addTable('s:1');
    expect(store.getState().version).toBe(2);
  });
});

describe('renameTable', () => {
  test('changes desired only, and the diff is one rename', () => {
    store.getState().renameTable('t:10', 'people');
    expect(store.getState().desired.tables['t:10']!.name).toBe('people');
    expect(store.getState().baseline.tables['t:10']!.name).toBe('users');
    expect(ops().ops).toEqual([
      { kind: 'renameTable', tableId: 't:10', from: 'users', to: 'people' },
    ]);
  });

  test('renaming back leaves no change, and a pending table is just renamed', () => {
    store.getState().renameTable('t:10', 'people');
    store.getState().renameTable('t:10', 'users');
    expect(opKinds()).toEqual([]);
    const id = store.getState().addTable('s:1');
    store.getState().renameTable(id, 'audit');
    expect(ops().ops[0]).toMatchObject({
      kind: 'createTable',
      table: { name: 'audit' },
    });
  });

  test('an unknown table is ignored', () => {
    store.getState().renameTable('nope', 'x');
    expect(store.getState().desired).toEqual(fixtureModel);
  });
});

describe('removeTable and restoreTable', () => {
  test('removing takes the table with its columns, keys and indexes, and the foreign keys that point at it', () => {
    expect(store.getState().removeTable('t:10')).toBeNull();
    const { desired } = store.getState();
    expect(desired.tables['t:10']).toBeUndefined();
    expect(
      Object.values(desired.columns).some((c) => c.tableId === 't:10'),
    ).toBe(false);
    expect(
      Object.values(desired.constraints).some((c) => c.tableId === 't:10'),
    ).toBe(false);
    // invoices.user_id → users.id, on another table, goes too
    expect(desired.constraints['k:2']).toBeUndefined();
    expect(desired.tables['t:20']).toBeDefined();
    expect(opKinds()).toEqual(['dropConstraint', 'dropTable']);
    expect(validateModel(assignNames(desired))).toEqual([]);
  });

  test('removing and restoring leaves an empty diff and the loaded model', () => {
    store.getState().removeTable('t:10');
    store.getState().restoreTable('t:10');
    expect(opKinds()).toEqual([]);
    expect(store.getState().desired).toEqual(fixtureModel);
    expect(store.getState().version).toBe(2);
  });

  test('a renamed table that is removed comes back with the name it was loaded with', () => {
    store.getState().renameTable('t:10', 'people');
    store.getState().removeTable('t:10');
    store.getState().restoreTable('t:10');
    expect(store.getState().desired.tables['t:10']!.name).toBe('users');
    expect(opKinds()).toEqual([]);
  });

  test('two tables that point at each other come back whichever is restored first', () => {
    for (const order of [
      ['t:10', 't:20'],
      ['t:20', 't:10'],
    ]) {
      store.getState().load({ model: fixtureModel, casts, fingerprint: 'f' });
      // the view on invoices would refuse: take it out of what the guard looks at
      const model = structuredClone(fixtureModel);
      delete model.unmodeled['u:1'];
      store.getState().load({ model, casts, fingerprint: 'f' });
      expect(store.getState().removeTable('t:10')).toBeNull();
      expect(store.getState().removeTable('t:20')).toBeNull();
      for (const id of order) store.getState().restoreTable(id);
      expect(store.getState().desired, order.join()).toEqual(model);
    }
  });

  test('a table a view depends on is refused, with the view named, and nothing changes', () => {
    const before = store.getState();
    const message = store.getState().removeTable('t:20');
    expect(message).toBe(
      `Can't delete table "invoices": view "open_invoices" still depends on it`,
    );
    expect(store.getState().desired).toBe(before.desired);
    expect(store.getState().version).toBe(0);
  });

  test('a pending table is removed for good, and restoring it does nothing', () => {
    const id = store.getState().addTable('s:1');
    expect(store.getState().removeTable(id)).toBeNull();
    store.getState().restoreTable(id);
    expect(store.getState().desired).toEqual(fixtureModel);
    expect(opKinds()).toEqual([]);
  });

  test('removing something that is not there, or restoring what is, is ignored', () => {
    expect(store.getState().removeTable('nope')).toBeNull();
    store.getState().restoreTable('t:10');
    expect(store.getState().version).toBe(0);
  });
});
